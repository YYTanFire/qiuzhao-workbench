'use strict';
/**
 * 数据源：超级简历 WonderCV 校招信息汇总（wondercv.com/xiaozhao/）
 * 列表卡片含：公司名、摘要（岗位描述）、城市、批次标签、学历标签、详情链接。
 * 只保留面向 2027 届的校招（秋招/提前批/春招/补录），排除实习与其他届别。
 * 原始解析结果缓存 data/wondercv-raw.json
 *
 * 用法：
 *   node server/import-wondercv.js            # 抓列表（默认前 80 页）+导入
 *   node server/import-wondercv.js --cache     # 仅用缓存导入
 *   node server/import-wondercv.js --pages 60  # 调整抓取页数
 */
const fs = require('node:fs');
const path = require('node:path');
const { buildRow, dedupWithinSource, importRows } = require('./import-utils');

const SOURCE_NAME = 'WonderCV超级简历（校招汇总）';
const DATA_DIR = path.join(__dirname, '..', 'data');
const RAW_PATH = path.join(DATA_DIR, 'wondercv-raw.json');
const BASE = 'https://www.wondercv.com/xiaozhao/';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function decode(s) {
  return (s || '').replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#x27;/g, "'").replace(/&quot;/g, '"').trim();
}
function clean(s) { return decode(s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')); }

async function get(u) {
  for (let a = 0; a < 3; a++) {
    const r = await fetch(u, { headers: { 'User-Agent': UA } });
    if (r.status === 429) { await sleep(12000 * (a + 1)); continue; }
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.text();
  }
  throw new Error('429 重试耗尽 ' + u);
}

/** 解析单页所有卡片 */
function parseCards(html) {
  const out = [];
  const re = /<a\s+([^>]*class="campus-job-card[^"]*"[^>]*)>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const openAttrs = m[1];
    const inner = m[2];
    const hrefM = openAttrs.match(/href="([^"]+)"/i);
    const href = hrefM ? hrefM[1] : '';
    const companyM = inner.match(/<div class="company"[^>]*>([\s\S]*?)<\/div>/i);
    const summaryM = inner.match(/<div class="summary"[^>]*>\s*<p[^>]*>([\s\S]*?)<\/p>/i);
    const tagsM = inner.match(/<div class="info-tags"[^>]*>([\s\S]*?)<\/div>/i);
    const company = companyM ? clean(companyM[1]) : '';
    const summary = summaryM ? clean(summaryM[1]) : '';
    const tags = tagsM ? [...tagsM[1].matchAll(/<span[^>]*>([\s\S]*?)<\/span>/gi)].map((mm) => clean(mm[1])).filter(Boolean) : [];
    if (!company) continue;
    const fullHref = href.startsWith('http') ? href : 'https://www.wondercv.com' + href;
    out.push({ company, summary, tags, url: fullHref });
  }
  return out;
}

/** 从 tags 中识别批次与学历、城市 */
function classify(card) {
  const blob = card.summary + ' ' + card.url;
  // 届别：2027 / 27届 / 27秋招；排除其他届
  const is2027 = /2027|27届|27秋招|27春招/.test(blob) && !/2026届|2025届|2028届|2024届|23届/.test(blob);
  // 实习排除
  const isIntern = /暑期实习|寒假实习|日常实习|实习/.test(blob) && !/校招|校园招聘|秋招|春招|提前批/.test(blob);
  // 批次标签
  let batch = '';
  if (card.tags.some((t) => /提前批/.test(t))) batch = '提前批';
  else if (card.tags.some((t) => /秋招补录|补录|补招/.test(t))) batch = '补录批';
  else if (card.tags.some((t) => /春招/.test(t))) batch = '春招批';
  else if (card.tags.some((t) => /秋招/.test(t))) batch = '秋招批';
  else if (/提前批/.test(blob)) batch = '提前批';
  else if (/秋招|校招|校园招聘/.test(blob)) batch = '秋招批';
  // 城市：tags 中第一个非批次/非学历/非函数词
  const batchTags = ['秋招', '春招', '提前批', '秋招补录', '春招补录', '暑期实习', '寒假实习', '实习', '无数据'];
  const eduTags = ['大专', '本科', '硕士', '博士', 'MBA'];
  const city = card.tags.find((t) => !batchTags.includes(t) && !eduTags.includes(t) && !/技术|研发|工程|市场|销售|财务|人力|运营|设计|产品|管理|金融|咨询|能源|机械|电子|半导体|通信|汽车|制造|医药|医疗|化工|材料|计算机|软件|互联网|国企|央企|民企|外企|合资|事业|政府|其他/.test(t)) || '';
  const education = card.tags.find((t) => eduTags.includes(t)) || '';
  return { is2027, isIntern, batch, city, education };
}

async function crawl(maxPages) {
  const all = [];
  for (let p = 1; p <= maxPages; p++) {
    const u = p === 1 ? BASE : `https://www.wondercv.com/xiaozhao/page/pn${p}/`;
    try {
      const html = await get(u);
      const cards = parseCards(html);
      if (!cards.length) { console.log(`  列表页 ${p} 无卡片，停止`); break; }
      all.push(...cards);
      if (p % 10 === 0) console.log(`  列表页 ${p}: 累计卡片 ${all.length}`);
      await sleep(700);
    } catch (e) {
      console.log(`  列表页 ${p} 失败: ${e.message}，停止`);
      break;
    }
  }
  return all;
}

async function main() {
  const onlyCache = process.argv.includes('--cache');
  const pagesArg = process.argv.find((a) => a.startsWith('--pages'));
  const maxPages = pagesArg ? Number(pagesArg.split('=')[1] || 80) : 80;

  let cards;
  if (onlyCache && fs.existsSync(RAW_PATH)) {
    cards = JSON.parse(fs.readFileSync(RAW_PATH, 'utf8'));
    console.log(`[WonderCV] 使用缓存卡片 ${cards.length}`);
  } else {
    console.log(`[WonderCV] 抓取列表前 ${maxPages} 页...`);
    cards = await crawl(maxPages);
    fs.writeFileSync(RAW_PATH, JSON.stringify(cards, null, 2));
    console.log(`[WonderCV] 原始卡片 ${cards.length}，已缓存 data/wondercv-raw.json`);
  }

  const rows = [];
  let kept = 0, dropped = 0;
  for (const c of cards) {
    const cls = classify(c);
    if (!cls.is2027 || cls.isIntern) { dropped++; continue; }
    kept++;
    rows.push(buildRow({
      company: c.company,
      position: `2027届${cls.batch === '提前批' ? '校招提前批' : cls.batch === '春招批' ? '春招' : '秋招'}`,
      batch: cls.batch,
      location: cls.city || '未明确',
      education_required: cls.education,
      major_requirement: c.summary,
      apply_url: c.url,
      official_url: c.url,
      source: SOURCE_NAME,
    }));
  }
  const deduped = dedupWithinSource(rows);
  console.log(`[WonderCV] 保留2027校招 ${kept}，丢弃(非2027/实习) ${dropped}；岗位行 ${rows.length}，去重后 ${deduped.length}`);
  const res = importRows(deduped, SOURCE_NAME);
  console.log(JSON.stringify(res));
}

main().catch((e) => { console.error('导入失败:', e); process.exit(1); });
