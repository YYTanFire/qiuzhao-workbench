'use strict';
/**
 * 飞书多维表格数据源刷新脚本（手动入口）
 * 用法：
 *   node server/import-feishu.js          # 重新拉取飞书表 → 刷新本地缓存 → 导入岗位库
 *   node server/import-feishu.js --cache  # 仅用已有缓存重新导入（不联网）
 * 每日 03:00 的自动同步也会执行同样的拉取+导入，无需手动运行。
 */
const { refreshFeishuCache, importFeishuFromCache } = require('./sync');

async function main() {
  const onlyCache = process.argv.includes('--cache');
  if (onlyCache) {
    console.log('使用已有本地缓存导入（--cache）');
  } else {
    console.log('正在从飞书多维表格拉取最新记录（约 1-2 分钟）...');
    const n = await refreshFeishuCache();
    if (n === 0) console.log('拉取失败，尝试用旧缓存导入');
  }
  const r = importFeishuFromCache();
  console.log(`导入完成：新增 ${r.added}，跳过（已有其他来源）${r.skipped}，标准化岗位 ${r.rows} 条`);
}

main().catch((e) => { console.error('导入失败:', e.message); process.exit(1); });
