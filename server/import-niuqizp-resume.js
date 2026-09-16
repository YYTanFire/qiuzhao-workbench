'use strict';
/**
 * 续导脚本：从 data/niuqizp-raw.json 重建标准行，
 * 仅导入 DB 中本 source 尚不存在的（company+position+batch）记录。
 * 用于在分批导入被中断后补齐剩余部分。
 */
const fs = require('fs');
const path = require('path');
const { all, db } = require('./db');
const { buildRow, dedupWithinSource, importRows, normalizeBatch, parseDeadline } = require('./import-utils');
const { buildRowsFromRaw } = require('./import-niuqizp');

const SOURCE_NAME = '牛企直聘（公开校招公告）';
const RAW_CACHE = path.join(__dirname, '..', 'data', 'niuqizp-raw.json');

(async () => {
  const rawItems = JSON.parse(fs.readFileSync(RAW_CACHE, 'utf8'));
  const { rows } = buildRowsFromRaw(rawItems);
  const deduped = dedupWithinSource(rows);
  console.log('去重后总行数:', deduped.length);

  // 查询本 source 已存在的 (company|position|batch) 集合
  const existing = all(`SELECT company, position, batch FROM jobs WHERE source = ?`, [SOURCE_NAME]);
  const existSet = new Set(existing.map((r) => `${r.company}|${r.position}|${r.batch || ''}`));
  console.log('DB中本source已有:', existSet.size);

  const missing = deduped.filter((r) => !existSet.has(`${r.company}|${r.position}|${r.batch || ''}`));
  console.log('待导入(DB中不存在):', missing.length);

  if (missing.length === 0) {
    console.log('无需导入，全部已存在。');
    return;
  }

  // 小批量导入，每批500，避免超时
  const B = 500;
  let added = 0, updated = 0, skipped = 0;
  for (let i = 0; i < missing.length; i += B) {
    const chunk = missing.slice(i, i + B);
    const r = importRows(chunk, `${SOURCE_NAME} [续${Math.floor(i / B) + 1}/${Math.ceil(missing.length / B)}]`);
    added += r.added; updated += r.updated; skipped += r.skipped;
  }
  const total = all('SELECT COUNT(*) AS c FROM jobs')[0].c;
  const srcCount = all(`SELECT COUNT(*) AS c FROM jobs WHERE source = ?`, [SOURCE_NAME])[0].c;
  console.log(`\n=== 续导完成 ===`);
  console.log(`新增 ${added}，更新 ${updated}，跳过 ${skipped}`);
  console.log(`库总数 ${total}，本source共 ${srcCount}`);
})();
