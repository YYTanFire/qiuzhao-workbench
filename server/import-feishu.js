'use strict';
/**
 * 飞书多维表格数据源刷新脚本
 * 用途：用户自建「校招汇总表（优先）」→ 拉取全量记录 → 本地缓存 data/feishu-jobs.json → 导入岗位库
 * 用法：
 *   node server/import-feishu.js          # 重新拉取飞书表并导入
 *   node server/import-feishu.js --cache  # 仅用已有缓存重新导入（不联网）
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { importFeishuFromCache } = require('./sync');

const BASE_TOKEN = 'S96LbTe5janAapsVxicchqHnnDQ';
const TABLE_ID = 'tbl2fptglpEwS8zp';
const CACHE_PATH = path.join(__dirname, '..', 'data', 'feishu-jobs.json');

function page(offset, limit) {
  const args = ['base', '+record-list', '--base-token', BASE_TOKEN, '--table-id', TABLE_ID,
    '--format', 'json', '--limit', String(limit), '--offset', String(offset), '--as', 'user'];
  const out = execFileSync('lark-cli', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return JSON.parse(out);
}

function fetchAll() {
  const first = page(0, 200);
  const fields = first.data.fields.map((name, i) => ({ name, id: first.data.field_id_list[i] }));
  const records = [...first.data.data];
  let offset = first.data.data.length;
  while (first.data.has_more) {
    const p = page(offset, 200);
    records.push(...p.data.data);
    offset += p.data.data.length;
    if (!p.data.has_more) break;
    process.stdout.write(`已拉取 ${records.length} 条...\r`);
  }
  return { fields, records };
}

async function main() {
  const onlyCache = process.argv.includes('--cache');
  if (!onlyCache) {
    console.log('正在从飞书多维表格拉取记录...');
    const data = fetchAll();
    fs.writeFileSync(CACHE_PATH, JSON.stringify(data, null, 1), 'utf8');
    console.log(`已缓存 ${data.records.length} 条记录 → data/feishu-jobs.json`);
  } else {
    console.log('使用已有本地缓存导入（--cache）');
  }
  const r = importFeishuFromCache();
  console.log(`导入完成：新增 ${r.added}，跳过（已有其他来源）${r.skipped}，标准化岗位 ${r.rows} 条`);
}

main().catch((e) => { console.error('导入失败:', e.message); process.exit(1); });
