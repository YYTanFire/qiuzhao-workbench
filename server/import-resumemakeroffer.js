'use strict';
/**
 * 数据源：AI简历姬（resumemakeroffer.com）2027届校招雷达
 * 流程：抓 2027届毕业筛选公司列表（分页）→ 逐公司详情页 → 解析 meta 结构化字段
 * 原始解析结果缓存到 data/resumemakeroffer-raw.json；公司URL缓存 data/rm-company-urls.json
 *
 * 用法：
 *   node server/import-resumemakeroffer.js            # 全量抓取+导入
 *   node server/import-resumemakeroffer.js --cache     # 仅用 raw 缓存导入，不联网
 *   node server/import-resumemakeroffer.js --max 40   # 仅抓前 N 家（调试）
 */
const fs = require('node:fs');
const path = require('node:path');
const { buildRow, dedupWithinSource, importRows } = require('./import-utils');

const SOURCE_NAME = 'AI简历姬（2027届校招雷达）';
const DATA_DIR = path.join(__dirname, '..', 'data');
const RAW_PATH = path.join(DATA_DIR, 'resumemakeroffer-raw.json');
const URLS_PATH = path.join(DATA_DIR, 'rm-company-urls.json');
const BASE = 'https://www.resumemakeroffer.com';
const LIST_BASE = BASE + '/jobradar/companies/graduation/2027%E5%B1%8A';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(u) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const r = await fetch(u, { headers: { 'User-Agent': UA, Accept: 'text/html' } });
    if (r.status === 429) {
      const wait = 15000 * (attempt + 1);
      console.log(`  429 限流，等待 ${wait / 1000}s 后重试 (${attempt + 1}/4)`);
      await sleep(wait);
      continue;
    }
    if (!r.ok) throw new Error(`HTTP ${r.status} ${u}`);
    return r.text();
  }
  throw new Error('HTTP 429 重试耗尽 ' + u);
}

/** 收集 2027届 公司详情页 URL（去重） */
async function collectCompanyUrls() {
  if (fs.existsSync(URLS_PATH)) {
    const cached = JSON.parse(fs.readFileSync(URLS_PATH, 'utf8'));
    if (cached.length) return cached;
  }
  const seen = new Map();
  let page = 1;
  for (; page <= 40; page++) {
    const u = page === 1 ? LIST_BASE : `${LIST_BASE}/page/${page}`;
    try {
      const html = await get(u);
      const ids = [...html.matchAll(/href="\/jobradar\/companies\/(\d+)-([^"]*)"/gi)];
      let newOnPage = 0;
      for (const m of ids) {
        const id = m[1];
        if (!seen.has(id)) { seen.set(id, `${BASE}/jobradar/companies/${id}-${m[2]}`); newOnPage++; }
      }
      console.log(`  列表页 ${page}: 累计公司 ${seen.size}（本页新增 ${newOnPage}）`);
      if (newOnPage === 0) break; // 没有新公司了
      await sleep(900);
    } catch (e) {
      console.log(`  列表页 ${page} 失败: ${e.message}，停止翻页`);
      break;
    }
  }
  const urls = [...seen.values()];
  fs.writeFileSync(URLS_PATH, JSON.stringify(urls, null, 2));
  return urls;
}

function parseDetail(html, url) {
  const dm = html.match(/<meta name="description" content="([^"]*)"/i);
  const tm = html.match(/<title>([^<]*)<\/title>/i);
  const title = tm ? tm[1].replace(/&amp;/g, '&') : '';
  const md = dm ? dm[1] : '';
  const out = { url, title, meta_desc: md };

  let m = md.match(/投递截止\s*([0-9]{4}-[0-9]{1,2}-[0-9]{1,2})/);
  out.deadline_raw = m ? m[1] : '';
  m = md.match(/招聘岗位[:：]\s*([^；;。]+)/);
  out.positions = m ? m[1].split(/[、，,]/).map((s) => s.replace(/，?以官方职位页为准$/, '').trim()).filter(Boolean) : [];
  m = md.match(/工作地点[:：]\s*([^；;。]+)/);
  out.location = m ? m[1].trim() : '';
  m = md.match(/所属行业[:：]\s*([^；;。]+)/);
  out.industry = m ? m[1].trim() : '';

  out.company = title.split(/2027|校招|秋招|春招|·/)[0].trim();
  const blob = title + ' ' + md;
  // 列表已是 2027届 筛选，这里做轻量校验：含2027且非2028/2026届
  out.year2027 = /2027/.test(blob) && !/2028届|2026届|2025届/.test(blob);
  out.isIntern = /(暑期实习|日常实习)/.test(blob) && !/(校招|校园招聘|秋招|春招|提前批)/.test(blob);
  if (/提前批/.test(blob)) out.batch = '提前批';
  else if (/春招/.test(blob)) out.batch = '春招批';
  else if (/补录|补招/.test(blob)) out.batch = '补录批';
  else if (/秋招|校招|校园招聘/.test(blob)) out.batch = '秋招批';
  else out.batch = '';

  const idm = url.match(/\/companies\/(\d+)/);
  out.apply_url = idm ? `https://app.resumemakeroffer.com/companies/${idm[1]}?intent=apply` : url;
  return out;
}

async function crawlDetails(urls, max, existingByUrl) {
  const list = max ? urls.slice(0, max) : urls;
  // 断点续抓：跳过已缓存的公司详情
  const todo = list.filter((u) => !existingByUrl.has(u));
  const items = [...existingByUrl.values()];
  console.log(`  待抓取 ${todo.length}（已缓存 ${items.length}），串行 + 退避`);
  let done = 0;
  for (const u of todo) {
    try {
      const html = await get(u);
      items.push(parseDetail(html, u));
    } catch (e) {
      console.log(`  详情失败: ${u} -> ${e.message}`);
    }
    done++;
    if (done % 20 === 0) console.log(`  进度 ${done}/${todo.length}`);
    await sleep(1200);
  }
  return items;
}

async function main() {
  const onlyCache = process.argv.includes('--cache');
  const maxArg = process.argv.find((a) => a.startsWith('--max'));
  const max = maxArg ? Number(maxArg.split('=')[1] || process.argv[process.argv.indexOf(maxArg) + 1]) : 0;

  let raw;
  if (onlyCache && fs.existsSync(RAW_PATH)) {
    raw = JSON.parse(fs.readFileSync(RAW_PATH, 'utf8'));
    console.log(`[AI简历姬] 使用缓存 raw ${raw.length} 条`);
  } else {
    console.log('[AI简历姬] 收集 2027届 公司列表...');
    const urls = await collectCompanyUrls();
    console.log(`[AI简历姬] 共 ${urls.length} 家公司，抓取缺失详情...`);
    // 已有缓存按 url 建索引，实现断点续抓
    const existingByUrl = new Map();
    if (fs.existsSync(RAW_PATH)) {
      for (const it of JSON.parse(fs.readFileSync(RAW_PATH, 'utf8'))) {
        if (it && it.url) existingByUrl.set(it.url, it);
      }
    }
    raw = await crawlDetails(urls, max, existingByUrl);
    fs.writeFileSync(RAW_PATH, JSON.stringify(raw, null, 2));
    console.log(`[AI简历姬] 原始解析 ${raw.length} 条，已缓存到 data/resumemakeroffer-raw.json`);
  }

  // 过滤：仅2027届校招，排除纯实习
  const valid = raw.filter((r) => r && r.year2027 && !r.isIntern && r.company && r.positions.length);
  console.log(`[AI简历姬] 过滤后有效公司 ${valid.length}（2027届校招，非纯实习）`);

  // 一家公司多岗位 → 多行；未列具体岗位的公司 → 保留一条公司级「2027届校招」行
  const rows = [];
  let companyLevel = 0;
  for (const c of valid) {
    const posList = c.positions.length ? c.positions : ['2027届校园招聘'];
    if (!c.positions.length) companyLevel++;
    for (const pos of posList) {
      const row = buildRow({
        company: c.company,
        position: pos,
        batch: c.batch,
        industry: c.industry,
        location: c.location,
        deadline_raw: c.deadline_raw,
        apply_url: c.apply_url,
        official_url: c.url,
        source: SOURCE_NAME,
      });
      if (row) rows.push(row);
    }
  }
  const deduped = dedupWithinSource(rows);
  console.log(`[AI简历姬] 公司级行 ${companyLevel}（无具体岗位），展开岗位行共 ${rows.length}，源内去重后 ${deduped.length}`);
  const res = importRows(deduped, SOURCE_NAME);
  console.log(JSON.stringify(res));
}

main().catch((e) => { console.error('导入失败:', e); process.exit(1); });
