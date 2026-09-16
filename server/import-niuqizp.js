'use strict';
/**
 * 牛企直聘（公开校招公告）抓取与导入脚本
 *
 * 入口：https://campus.niuqizp.com/schedulenew-1/ （2027届校招汇总列表，共 97 页）
 * 列表页服务端渲染，每条 <article class="schedule-card"> 直接包含：
 *   公司名(含批次后缀) / 岗位列表 / 工作城市 / 网申起止日期 / 详情页URL
 *
 * 用法：
 *   node server/import-niuqizp.js            # 全量抓取 + 导入
 *   node server/import-niuqizp.js --cached   # 使用 data/niuqizp-raw.json 缓存，仅重新清洗+导入
 *
 * 只收录 2027 届校招（秋招批/提前批/春招批/补录批），
 * 排除：日常实习、社招、26届/25届/更早届、26春招等非2027内容。
 */
const fs = require('fs');
const path = require('path');
const https = require('https');
const { URL } = require('url');

const { buildRow, dedupWithinSource, importRows, normalizeBatch, parseDeadline } = require('./import-utils');

const SOURCE_NAME = '牛企直聘（公开校招公告）';
const BASE = 'https://campus.niuqizp.com';
const LIST_URL = (p) => `${BASE}/schedulenew-${p}/`;
const RAW_CACHE = path.join(__dirname, '..', 'data', 'niuqizp-raw.json');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const REQ_DELAY_MS = 1200;
const MAX_RETRY = 3;

// ---------- HTTP ----------
function fetchPage(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': UA, 'Accept': 'text/html,application/xhtml+xml' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects < 5) {
        const next = new URL(res.headers.location, url).href;
        res.resume();
        return resolve(fetchPage(next, redirects + 1));
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        // 关键：先拼接 Buffer 再统一按 UTF-8 解码，避免跨 chunk 的多字节字符被截断乱码
        const buf = Buffer.concat(chunks);
        resolve({ status: res.statusCode, body: buf.toString('utf8') });
      });
    }).on('error', reject);
  });
}

async function fetchWithRetry(url) {
  let lastErr;
  for (let i = 0; i < MAX_RETRY; i++) {
    try {
      const { status, body } = await fetchPage(url);
      if (status === 200) return body;
      lastErr = new Error(`HTTP ${status}`);
    } catch (e) {
      lastErr = e;
    }
    await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
  }
  throw lastErr;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- HTML 解析 ----------
function stripTags(s) {
  return String(s || '').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim();
}

/** 从卡片 HTML 中提取文本（去掉 svg 内联图标干扰） */
function textAfterSvg(block) {
  // 去掉 <svg ...>...</svg> 整块，再取首个文本节点
  return stripTags(block.replace(/<svg[\s\S]*?<\/svg>/g, '')).trim();
}

function parseArticles(html) {
  const arts = [...html.matchAll(/<article class="schedule-card">([\s\S]*?)<\/article>/g)].map((m) => m[1]);
  return arts.map((a) => {
    const cm = a.match(/schedule-card-company">[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/);
    const companyRaw = stripTags(cm ? cm[1] : '');

    const dm = a.match(/href="(\/schedule-[^"]+\.html)"/);
    const detailPath = dm ? dm[1] : '';

    const tm = a.match(/schedule-card-title">[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/);
    const title = stripTags(tm ? tm[1] : '');

    // 网申日期区间（取 </svg> 之后的文本）
    const drm = a.match(/schedule-card-date" title="网申日期">[\s\S]*?<\/svg>([^<]*)</);
    const dateRange = drm ? stripTags(drm[1]) : '';

    const lm = a.match(/schedule-card-location" title="招聘城市">[\s\S]*?<\/svg>([^<]*)</);
    const locationRaw = lm ? stripTags(lm[1]) : '';

    const positions = [...a.matchAll(/class="job-postion">([^<]+)</g)].map((m) => stripTags(m[1])).filter(Boolean);

    const bm = a.match(/schedule-card-date-value">[\s\S]*?>([^<]*)</);
    const badge = bm ? stripTags(bm[1]) : '';

    return { companyRaw, detailPath, title, dateRange, locationRaw, positions, badge };
  });
}

// ---------- 清洗逻辑 ----------
/** 是否为 2027 届校招（排除实习/社招/非2027届） */
function is2027Campus(companyRaw, title) {
  const text = `${companyRaw} ${title}`;
  // 排除实习与社招
  if (/实习/.test(text)) return false;
  if (/社招/.test(text)) return false;
  // 排除显式非 2027 届（21~26 届、26春招等）
  if (/(20)?(21|22|23|24|25|26)届/.test(text)) return false;
  if (/(21|22|23|24|25|26)春招/.test(text)) return false;
  // 其余在本 2027 汇总页内，视为 2027 届校招
  return true;
}

/** 从公司名原始串中剥离年份/批次后缀，返回纯公司名 */
function cleanCompany(companyRaw) {
  let s = String(companyRaw || '').trim();
  // 去掉开头的【预告】等标记
  s = s.replace(/^【[^】]*】\s*/g, '').trim();
  // 在第一个「年份/批次词」处截断公司名
  const m = s.match(/^(.*?)\s+(?:【[^】]*】\s*)?(?:(?:20)?\d{2}届|(?:20)?\d{2}年|提前批|秋招|校招|春招|补录|补招|宣讲会|日常实习|社招|青年英才|实习|招聘).*$/);
  if (m && m[1].trim()) s = m[1].trim();
  return s.replace(/\s+/g, ' ').slice(0, 100);
}

/** 从网申区间中提取截止日期（取最后一个日期） */
function extractDeadline(dateRange, badge) {
  const text = `${dateRange} ${badge}`;
  const dates = [...String(text).matchAll(/(\d{4})[\/\-.年](\d{1,2})[\/\-.月](\d{1,2})/g)];
  if (dates.length) {
    const last = dates[dates.length - 1];
    return `${last[1]}-${last[2].padStart(2, '0')}-${last[3].padStart(2, '0')}`;
  }
  // 无法解析日期，保留 badge 原文
  return badge && badge !== '不详' ? badge : '';
}

/** 批次推断：优先后缀词，否则默认秋招批（当前为2027秋招季） */
function inferBatch(companyRaw, title) {
  const raw = `${companyRaw} ${title}`;
  const b = normalizeBatch(raw);
  if (b) return b;
  // 无明确批次词 → 默认秋招批（2027届校招季）
  return '秋招批';
}

// ---------- 主流程 ----------
async function crawlAllPages() {
  const all = [];
  let page = 1;
  const TOTAL_PAGES = 97; // 列表页分页显示末页为 97
  while (page <= TOTAL_PAGES) {
    const url = LIST_URL(page);
    process.stdout.write(`\r抓取第 ${page}/${TOTAL_PAGES} 页 ...`);
    const html = await fetchWithRetry(url);
    const arts = parseArticles(html);
    arts.forEach((a) => (a._page = page));
    all.push(...arts);
    // 末页兜底：若某页文章数为 0，提前停止
    if (arts.length === 0) {
      console.log(`\n第 ${page} 页无公告，提前结束。`);
      break;
    }
    page++;
    await sleep(REQ_DELAY_MS);
  }
  console.log(`\n抓取完成，共 ${all.length} 条原始公告。`);
  return all;
}

function buildRowsFromRaw(rawItems) {
  const rows = [];
  const stats = { kept: 0, excluded: 0, excludedReasons: {} };
  for (const it of rawItems) {
    if (!is2027Campus(it.companyRaw, it.title)) {
      stats.excluded++;
      const reason = /实习/.test(it.companyRaw + it.title) ? '实习'
        : /社招/.test(it.companyRaw + it.title) ? '社招'
        : (it.companyRaw.match(/(20)?(21|22|23|24|25|26)届/) || [])[0] || '非2027届';
      stats.excludedReasons[reason] = (stats.excludedReasons[reason] || 0) + 1;
      continue;
    }
    const company = cleanCompany(it.companyRaw);
    if (!company) continue;
    const batch = inferBatch(it.companyRaw, it.title);
    const deadlineRaw = extractDeadline(it.dateRange, it.badge);
    let location = it.locationRaw || '';
    if (/^不详|未知$/.test(location)) location = '';
    const officialUrl = it.detailPath ? BASE + it.detailPath : '';

    const positions = it.positions.length ? it.positions : ['校园招聘岗位'];
    // 拆分反斜杠连接的岗位（如 "财务管理\化工染整" → 两条）
    const flatPositions = positions.flatMap((p) => p.split(/\\+/).map((s) => s.trim()).filter(Boolean));
    for (const pos of flatPositions) {
      // 排除岗位名本身为实习生的条目
      if (/实习生|实习/.test(pos)) continue;
      const row = buildRow({
        company,
        position: pos,
        location,
        deadline_raw: deadlineRaw,
        batch_raw: it.companyRaw,
        batch,
        source: SOURCE_NAME,
        official_url: officialUrl,
        session_year: '2027',
      });
      if (row) rows.push(row);
    }
    stats.kept++;
  }
  return { rows, stats };
}

async function main() {
  const useCached = process.argv.includes('--cached');
  let rawItems;
  if (useCached && fs.existsSync(RAW_CACHE)) {
    console.log(`使用缓存原始数据：${RAW_CACHE}`);
    rawItems = JSON.parse(fs.readFileSync(RAW_CACHE, 'utf8'));
  } else {
    rawItems = await crawlAllPages();
    fs.mkdirSync(path.dirname(RAW_CACHE), { recursive: true });
    fs.writeFileSync(RAW_CACHE, JSON.stringify(rawItems, null, 2), 'utf8');
    console.log(`原始数据已缓存到 ${RAW_CACHE}`);
  }

  const rawCount = rawItems.length;
  const { rows, stats } = buildRowsFromRaw(rawItems);
  console.log(`\n=== 清洗统计 ===`);
  console.log(`原始公告：${rawCount} 条`);
  console.log(`保留为2027校招：${stats.kept} 条，排除：${stats.excluded} 条`);
  console.log(`排除原因：`, stats.excludedReasons);
  console.log(`拆分岗位记录（去重前）：${rows.length} 条`);

  const deduped = dedupWithinSource(rows);
  console.log(`新源内部去重后：${deduped.length} 条`);

  // 分批导入：每批一个事务，避免单事务过大导致进程被杀；逐批累计
  const BATCH_SIZE = 2000;
  let added = 0, updated = 0, skipped = 0;
  for (let i = 0; i < deduped.length; i += BATCH_SIZE) {
    const chunk = deduped.slice(i, i + BATCH_SIZE);
    const r = importRows(chunk, `${SOURCE_NAME} [${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(deduped.length / BATCH_SIZE)}]`);
    added += r.added; updated += r.updated; skipped += r.skipped;
  }
  const { all } = require('./db');
  const total = all('SELECT COUNT(*) AS c FROM jobs')[0].c;
  const result = { added, updated, skipped, total, input: deduped.length };
  console.log(`\n=== 导入结果（汇总）===`);
  console.log(JSON.stringify(result, null, 2));

  return { rawCount, ...stats, splitBeforeDedup: rows.length, deduped: deduped.length, ...result };
}

if (require.main === module) {
  main().catch((e) => {
    console.error('运行失败：', e);
    process.exit(1);
  });
}

module.exports = { parseArticles, is2027Campus, cleanCompany, extractDeadline, inferBatch, buildRowsFromRaw };
