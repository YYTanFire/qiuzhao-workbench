'use strict';
/**
 * 数据源：campus2027.top —— 2027届互联网校招&实习汇总（静态表格站）
 * 只抓「校招篇」：表0=校招提前批，表1-6=校招正式批（各类别）。
 * 「实习篇」表7-12 为日常实习/暑期实习，按要求排除。
 * 该源为公司级信息（投递入口、地点、批次），position 取批次标签。
 *
 * 用法：node server/import-campus2027.js [--cache]
 *   --cache  仅用本地缓存 data/campus2027-raw.json 重新导入
 */
const fs = require('node:fs');
const path = require('node:path');
const { buildRow, dedupWithinSource, importRows } = require('./import-utils');

const SOURCE_NAME = 'campus2027（2027届校招汇总）';
const RAW_PATH = path.join(__dirname, '..', 'data', 'campus2027-raw.json');
const HOME = 'https://campus2027.top/';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

const TABLE_BATCH = { 0: '提前批', 1: '秋招批', 2: '秋招批', 3: '秋招批', 4: '秋招批', 5: '秋招批', 6: '秋招批' };
const TABLE_CAT = { 0: '互联网&AI', 1: '互联网&AI', 2: '外企', 3: '游戏', 4: '车企&通信&IC', 5: '金融&地产&国企', 6: '安全&软件&云服务' };

function clean(s) {
  return (s || '').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim();
}

function parseHtml(html) {
  const tables = html.match(/<table[\s\S]*?<\/table>/gi) || [];
  const items = [];
  for (let i = 0; i <= 6; i++) {
    if (!tables[i]) continue;
    const batch = TABLE_BATCH[i];
    const industry = TABLE_CAT[i] || '';
    const trs = tables[i].matchAll(/<tr>([\s\S]*?)<\/tr>/gi);
    for (const tr of trs) {
      const cells = [...tr[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)];
      if (cells.length < 4) continue;
      const company = clean(cells[0][1]);
      const statusCell = cells[1][1];
      const hrefM = statusCell.match(/<a[^>]*href="([^"]+)"/i);
      const applyUrl = hrefM ? hrefM[1] : '';
      const statusText = clean(statusCell);
      const location = clean(cells[3][1]);
      const note = clean(cells[4] ? cells[4][1] : '');
      if (!company) continue;
      items.push({
        company,
        position: `2027届${statusText || (batch === '提前批' ? '校招提前批' : '校招正式批')}`,
        batch,
        industry,
        location,
        apply_url: applyUrl,
        official_url: applyUrl || HOME,
        note,
        source_url: HOME,
      });
    }
  }
  return items;
}

async function fetchHtml() {
  const useCache = process.argv.includes('--cache') && fs.existsSync(RAW_PATH.replace(/\.json$/, '.html'));
  if (useCache) return fs.readFileSync(RAW_PATH.replace(/\.json$/, '.html'), 'utf8');
  const r = await fetch(HOME, { headers: { 'User-Agent': UA } });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const html = await r.text();
  fs.writeFileSync(RAW_PATH.replace(/\.json$/, '.html'), html);
  return html;
}

async function main() {
  const html = await fetchHtml();
  const raw = parseHtml(html);
  fs.writeFileSync(RAW_PATH, JSON.stringify(raw, null, 2));
  console.log(`[campus2027] 解析原始 ${raw.length} 条（公司级校招）`);

  const rows = raw.map((it) => buildRow({
    company: it.company,
    position: it.position,
    batch: it.batch,
    industry: it.industry,
    location: it.location,
    apply_url: it.apply_url,
    official_url: it.source_url,
    major_requirement: it.note,
    source: SOURCE_NAME,
  }));
  const deduped = dedupWithinSource(rows);
  console.log(`[campus2027] 去重后 ${deduped.length} 条`);
  const res = importRows(deduped, SOURCE_NAME);
  console.log(JSON.stringify(res));
}

main().catch((e) => { console.error('导入失败:', e); process.exit(1); });
