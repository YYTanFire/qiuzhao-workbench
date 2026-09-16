'use strict';
/**
 * 牛企直聘（公开校招公告）投递链接 & 公司官网回填脚本
 *
 * 流程：
 *   1. 读取 data/niuqizp-raw.json，去重得到详情页 URL（/schedule-XXX.html）
 *   2. 串行抓取详情页（间隔 ~0.7s），HTML 缓存到 data/niuqizp-detail/，已缓存则跳过（断点续抓）
 *   3. 从详情页解析：
 *        - apply_url ：<a class="post-button" target="_blank" ...> 指向外部域名的投递入口
 *                      （标题通常为「前往官网投递」，title="官网投递网址"）
 *                      若 schedule 页没有外部 post-button，则跟进 /job-XXX.html 子页取其 post-button
 *        - company_url：页面无独立官网链接；当 apply_url 指向企业自有域名（非微信/招聘聚合站）时复用
 *   4. 按公司汇总（同一公司多条公告，取最可靠的投递链接：优先非微信/非聚合站，其次最高频）
 *   5. 用 node:sqlite 直接连接（busy_timeout=30000），按公司批量 UPDATE，每批 500 条事务
 *      仅回填 apply_url / company_url 为空（'' 或 NULL）的记录，不覆盖已有值
 *
 * 用法：
 *   node server/enrich-niuqizp-links.js              # 全量：抓缺失详情页 + 解析 + 回填
 *   node server/enrich-niuqizp-links.js --parse-only # 不抓网络，仅用已有缓存解析 + 回填
 *   node server/enrich-niuqizp-links.js --no-db      # 不写库，仅抓取+解析+打印统计（干跑）
 *   node server/enrich-niuqizp-links.js --limit=N    # 只处理前 N 个详情页（调试）
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const { URL } = require('url');
const { DatabaseSync } = require('node:sqlite');

const ROOT = path.join(__dirname, '..');
const RAW_CACHE = path.join(ROOT, 'data', 'niuqizp-raw.json');
const DETAIL_DIR = path.join(ROOT, 'data', 'niuqizp-detail');
const DB_PATH = path.join(ROOT, 'data', 'qiuzhao.db');

const SOURCE_NAME = '牛企直聘（公开校招公告）';
const BASE = 'https://campus.niuqizp.com';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const REQ_DELAY_MS = 700;      // 串行抓取间隔
const MAX_RETRY = 3;

// ---------- 命令行参数 ----------
const ARGS = new Set(process.argv.slice(2));
const parseOnly = ARGS.has('--parse-only') || ARGS.has('--no-fetch');
const noDb = ARGS.has('--no-db');
const limitArg = [...ARGS].find((a) => a.startsWith('--limit='));
const LIMIT = limitArg ? parseInt(limitArg.split('=')[1], 10) : 0;

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
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
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
    } catch (e) { lastErr = e; }
    await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
  }
  throw lastErr;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 详情路径 → 本地缓存文件名（如 /schedule-xxx.html → schedule-xxx.html） */
function cacheNameFor(detailPath) {
  return detailPath.replace(/^\/+/, '').replace(/[\\/]/g, '_');
}
function cachePathFor(detailPath) {
  return path.join(DETAIL_DIR, cacheNameFor(detailPath));
}

/** 读取缓存，没有则抓取并落盘（返回 html；失败返回 null） */
async function getDetail(detailPath) {
  const cp = cachePathFor(detailPath);
  if (fs.existsSync(cp)) {
    return fs.readFileSync(cp, 'utf8');
  }
  if (parseOnly) return null; // 干跑/纯解析模式下不联网
  const url = BASE + detailPath;
  const html = await fetchWithRetry(url);
  fs.mkdirSync(DETAIL_DIR, { recursive: true });
  fs.writeFileSync(cp, html, 'utf8');
  await sleep(REQ_DELAY_MS);
  return html;
}

// ---------- HTML 解析 ----------
/**
 * 提取页面中所有 <a> 的完整属性与 href
 * 返回 [{href, tag, text}]
 */
function extractAnchors(html) {
  const out = [];
  const re = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const attrs = m[1];
    const hm = attrs.match(/href\s*=\s*["']([^"']*)["']/i);
    if (!hm) continue;
    const href = hm[1].trim();
    const text = m[2].replace(/<svg[\s\S]*?<\/svg>/g, '').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim();
    out.push({ href, attrs, text });
  }
  return out;
}

function isExternalHttp(href) {
  if (!href) return false;
  if (href.startsWith('//')) return true; // 协议相对
  if (/^https?:\/\//i.test(href)) return true;
  return false;
}
function resolveHref(href) {
  if (href.startsWith('//')) return 'https:' + href;
  if (href.startsWith('/')) return BASE + href;
  return href;
}
function hostOf(url) {
  try { return new URL(url).hostname.toLowerCase(); } catch (e) { return ''; }
}

// 微信文章 / 第三方招聘聚合 / 平台自身域名 —— 这些不算「公司官网」
const NON_COMPANY_HOST_RE = /(^|\.)(mp\.weixin\.qq\.com|weixin\.qq\.com|weibo\.com|zhihu\.com|xiaohongshu\.com|douyin\.com|bilibili\.com|zhaopin\.com|51job\.com|lagou\.com|zhipin\.com|kanzhun\.com|liepin\.com|niuqizp\.com|ahrefs\.com|googletagmanager\.com|clarity\.ms|googlesyndication\.com|cloudflare\.com|out\.niuqizp\.com|s\.niuqizp\.com)$/;

function looksLikeCompanySite(url) {
  const h = hostOf(url);
  if (!h) return false;
  if (NON_COMPANY_HOST_RE.test(h)) return false;
  // 纯 IP / localhost 也排除
  if (/^\d+\.\d+\.\d+\.\d+$/.test(h)) return false;
  return true;
}

/**
 * 从一个详情页 HTML 中提取投递链接。
 * 策略：找 class 含 post-button 的 <a>，取其 href 为外部链接者。
 * 返回 { applyUrl, subpagePath }
 */
function parseSchedulePage(html) {
  const anchors = extractAnchors(html);
  const buttons = anchors.filter((a) => /class="[^"]*post-button[^"]*"/i.test(a.attrs));

  // 1) 直接外部 post-button（前往官网投递 / title 含 投递|官网|申请|网申）
  for (const b of buttons) {
    if (!isExternalHttp(b.href)) continue;
    const titleMatch = b.attrs.match(/title\s*=\s*["']([^"']*)["']/i);
    const title = titleMatch ? titleMatch[1] : '';
    const looksApply = /投递|官网|申请|网申|报名/.test(title) || /投递|官网|申请|网申|报名/.test(b.text);
    if (looksApply || b.attrs.includes('target="_blank"')) {
      return { applyUrl: resolveHref(b.href), subpagePath: null };
    }
  }
  // 2) 兜底：任意外部 post-button
  for (const b of buttons) {
    if (isExternalHttp(b.href) && !b.href.startsWith('#')) {
      return { applyUrl: resolveHref(b.href), subpagePath: null };
    }
  }
  // 3) 没有直接投递按钮 → 记录 /job-XXX.html 子页路径，稍后跟进
  for (const b of buttons) {
    if (/^\/job-[\w-]+\.html$/.test(b.href)) {
      return { applyUrl: null, subpagePath: b.href };
    }
  }
  // 4) 最后兜底：全文找任意外部链接（排除导航/页脚/搜索 s.niuqizp）
  for (const a of anchors) {
    if (!isExternalHttp(a.href)) continue;
    const u = resolveHref(a.href);
    if (!looksLikeCompanySite(u)) continue;
    if (/投递|申请|网申|报名/.test(a.text)) return { applyUrl: u, subpagePath: null };
  }
  return { applyUrl: null, subpagePath: null };
}

/** 从 /job-XXX.html 子页提取投递链接（其 post-button 通常 title="查看信息来源"） */
function parseJobSubpage(html) {
  const anchors = extractAnchors(html);
  const buttons = anchors.filter((a) => /class="[^"]*post-button[^"]*"/i.test(a.attrs));
  for (const b of buttons) {
    if (isExternalHttp(b.href)) return resolveHref(b.href);
  }
  // 兜底：任意外部链接
  for (const a of anchors) {
    if (isExternalHttp(a.href)) return resolveHref(a.href);
  }
  return null;
}

/** 由 applyUrl 推导 company_url（仅当指向企业自有域名时） */
function deriveCompanyUrl(applyUrl) {
  if (!applyUrl) return null;
  return looksLikeCompanySite(applyUrl) ? applyUrl : null;
}

// ---------- 主流程 ----------
async function main() {
  console.log('=== 牛企直聘投递链接回填 ===');
  console.log(`模式：${parseOnly ? '纯解析(不联网)' : '抓取+解析'}${noDb ? ' + 干跑(不写库)' : ''}`);

  // 1) 读取原始公告，去重 detailPath
  const raw = JSON.parse(fs.readFileSync(RAW_CACHE, 'utf8'));
  const pathSet = new Map(); // detailPath -> 出现次数
  for (const it of raw) {
    if (!it.detailPath) continue;
    if (!/^\/schedule-[\w-]+\.html$/.test(it.detailPath)) continue;
    pathSet.set(it.detailPath, (pathSet.get(it.detailPath) || 0) + 1);
  }
  let detailPaths = [...pathSet.keys()];
  if (LIMIT > 0) detailPaths = detailPaths.slice(0, LIMIT);
  console.log(`去重后详情页：${detailPaths.length} 个`);

  // 2) 抓取 + 解析
  const results = new Map(); // detailPath -> { applyUrl, companyUrl, subpagePath }
  let fetched = 0, cached = 0, missing = 0, withApply = 0, subpageFetched = 0;
  const t0 = Date.now();

  for (let i = 0; i < detailPaths.length; i++) {
    const dp = detailPaths[i];
    const already = fs.existsSync(cachePathFor(dp));
    let html;
    try {
      html = await getDetail(dp);
    } catch (e) {
      console.log(`\n[${i + 1}/${detailPaths.length}] 抓取失败 ${dp}: ${e.message}`);
      missing++;
      continue;
    }
    if (html == null) { missing++; continue; }
    already ? cached++ : fetched++;

    let { applyUrl, subpagePath } = parseSchedulePage(html);

    // 跟进子页
    if (!applyUrl && subpagePath) {
      try {
        const subHtml = await getDetail(subpagePath);
        if (subHtml != null) {
          applyUrl = parseJobSubpage(subHtml);
          if (!already) subpageFetched++;
        }
      } catch (e) {
        console.log(`\n  子页失败 ${subpagePath}: ${e.message}`);
      }
    }

    const companyUrl = deriveCompanyUrl(applyUrl);
    if (applyUrl) withApply++;
    results.set(dp, { applyUrl, companyUrl, subpagePath });

    if ((i + 1) % 50 === 0 || i === detailPaths.length - 1) {
      const el = ((Date.now() - t0) / 1000).toFixed(0);
      process.stdout.write(`\r  进度 ${i + 1}/${detailPaths.length} | 新抓${fetched} 缓存${cached} 缺${missing} | 已提取apply ${withApply} | ${el}s`);
    }
  }
  console.log('\n');

  // 3) 按公司汇总：从 DB 取 official_url -> companies 映射
  console.log('读取 DB official_url -> company 映射 ...');
  const db = new DatabaseSync(DB_PATH);
  db.exec('PRAGMA busy_timeout = 30000');

  const urlToCompanies = new Map(); // official_url -> Set(company)
  const rows = db.prepare(`SELECT DISTINCT official_url, company FROM jobs WHERE source=?`).all(SOURCE_NAME);
  for (const r of rows) {
    if (!r.official_url) continue;
    if (!urlToCompanies.has(r.official_url)) urlToCompanies.set(r.official_url, new Set());
    urlToCompanies.get(r.official_url).add(r.company);
  }

  // 汇总 company -> { applyVote: Map(url->count), companyVote: Map(url->count) }
  const companyAgg = new Map(); // company -> { apply: Map, cu: Map }
  for (const [dp, res] of results) {
    const officialUrl = BASE + dp;
    const companies = urlToCompanies.get(officialUrl);
    if (!companies) continue; // 该公告未入库（被2027过滤等），跳过
    for (const company of companies) {
      if (!companyAgg.has(company)) companyAgg.set(company, { apply: new Map(), cu: new Map() });
      const agg = companyAgg.get(company);
      if (res.applyUrl) agg.apply.set(res.applyUrl, (agg.apply.get(res.applyUrl) || 0) + 1);
      if (res.companyUrl) agg.cu.set(res.companyUrl, (agg.cu.get(res.companyUrl) || 0) + 1);
    }
  }

  /** 从 vote Map 选最优：优先 looksLikeCompanySite，其次频次最高 */
  function pickBest(voteMap) {
    if (!voteMap || voteMap.size === 0) return null;
    const entries = [...voteMap.entries()];
    entries.sort((a, b) => {
      const ca = looksLikeCompanySite(a[0]) ? 1 : 0;
      const cb = looksLikeCompanySite(b[0]) ? 1 : 0;
      if (ca !== cb) return cb - ca;
      return b[1] - a[1];
    });
    return entries[0][0];
  }

  // 最终 company -> { applyUrl, companyUrl }
  const companyLinks = new Map();
  for (const [company, agg] of companyAgg) {
    const applyUrl = pickBest(agg.apply);
    let companyUrl = pickBest(agg.cu);
    // companyUrl 兜底：若 applyUrl 本身是企业站，也记为 companyUrl
    if (!companyUrl && applyUrl && looksLikeCompanySite(applyUrl)) companyUrl = applyUrl;
    if (applyUrl || companyUrl) companyLinks.set(company, { applyUrl, companyUrl });
  }

  console.log(`映射到 DB 公司：${companyLinks.size} 家（其中有 applyUrl：${[...companyLinks.values()].filter(v => v.applyUrl).length} 家）`);

  // 4) 回填前覆盖率
  const before = db.prepare(`
    SELECT COUNT(*) AS c,
      SUM(CASE WHEN apply_url IS NOT NULL AND apply_url<>'' THEN 1 ELSE 0 END) AS a,
      SUM(CASE WHEN company_url IS NOT NULL AND company_url<>'' THEN 1 ELSE 0 END) AS cu
    FROM jobs WHERE source=?`).get(SOURCE_NAME);

  if (noDb) {
    console.log('\n[干跑模式] 不写库。拟更新公司数：', companyLinks.size);
    console.log('回填前 stats:', before);
    db.close();
    return { fetched, cached, missing, withApply, companyLinksSize: companyLinks.size, before };
  }

  // 5) 批量 UPDATE，每批 500 条公司一个事务
  const BATCH = 500;
  const companies = [...companyLinks.entries()];
  let updatedApply = 0, updatedCu = 0, companyAffected = 0;
  const updApply = db.prepare(`UPDATE jobs SET apply_url=? WHERE source=? AND company=? AND (apply_url='' OR apply_url IS NULL)`);
  const updCu = db.prepare(`UPDATE jobs SET company_url=? WHERE source=? AND company=? AND (company_url='' OR company_url IS NULL)`);

  for (let i = 0; i < companies.length; i += BATCH) {
    const chunk = companies.slice(i, i + BATCH);
    db.exec('BEGIN');
    try {
      for (const [company, links] of chunk) {
        if (links.applyUrl) {
          const r = updApply.run(links.applyUrl, SOURCE_NAME, company);
          updatedApply += r.changes;
        }
        if (links.companyUrl) {
          const r = updCu.run(links.companyUrl, SOURCE_NAME, company);
          updatedCu += r.changes;
        }
        companyAffected++;
      }
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      console.error(`批 ${i / BATCH + 1} 回滚：`, e.message);
    }
    if ((i / BATCH + 1) % 5 === 0) process.stdout.write(`\r  写库 ${Math.min(i + BATCH, companies.length)}/${companies.length} ...`);
  }
  console.log('');

  // 6) 回填后覆盖率
  const after = db.prepare(`
    SELECT COUNT(*) AS c,
      SUM(CASE WHEN apply_url IS NOT NULL AND apply_url<>'' THEN 1 ELSE 0 END) AS a,
      SUM(CASE WHEN company_url IS NOT NULL AND company_url<>'' THEN 1 ELSE 0 END) AS cu
    FROM jobs WHERE source=?`).get(SOURCE_NAME);
  db.close();

  const summary = {
    detailPagesFetched: fetched,
    detailPagesCached: cached,
    detailPagesMissing: missing,
    subpagesFetched: subpageFetched,
    companiesWithApply: [...companyLinks.values()].filter(v => v.applyUrl).length,
    companiesWithCompanyUrl: [...companyLinks.values()].filter(v => v.companyUrl).length,
    companiesUpdated: companyAffected,
    jobsUpdatedApply: updatedApply,
    jobsUpdatedCompanyUrl: updatedCu,
    before, after,
  };
  console.log('\n=== 汇总 ===');
  console.log(JSON.stringify(summary, null, 2));
  return summary;
}

if (require.main === module) {
  main().catch((e) => { console.error('运行失败：', e); process.exit(1); });
}

module.exports = { parseSchedulePage, parseJobSubpage, extractAnchors, looksLikeCompanySite, deriveCompanyUrl };
