'use strict';
/**
 * 导入验证脚本：检查岗位总数、source分布、样本抽查、数据质量
 * 用法：node server/verify-import.js
 */
const { all, get } = require('./db');

function main() {
  console.log('========== 秋招作战台岗位库验证 ==========\n');

  // 1. 总数
  const total = get('SELECT COUNT(*) AS c FROM jobs').c;
  const realTotal = get('SELECT COUNT(*) AS c FROM jobs WHERE is_demo = 0').c;
  console.log(`【岗位总数】${total} 条（其中真实岗位 ${realTotal} 条，演示 ${total - realTotal} 条）`);

  // 2. 按 source 分组
  console.log('\n【按数据源分布】');
  const sources = all('SELECT source, COUNT(*) AS c FROM jobs WHERE source IS NOT NULL AND source != \'\' GROUP BY source ORDER BY c DESC');
  sources.forEach((s) => {
    const pct = ((s.c / total) * 100).toFixed(1);
    console.log(`  ${String(s.c).padStart(6)} 条 (${pct}%)  ${s.source}`);
  });
  console.log(`  共 ${sources.length} 个数据源`);

  // 3. 按批次分布
  console.log('\n【按批次分布】');
  const batches = all('SELECT batch, COUNT(*) AS c FROM jobs GROUP BY batch ORDER BY c DESC');
  batches.forEach((b) => console.log(`  ${String(b.c).padStart(6)} 条  ${b.batch || '(空)'}`));

  // 4. 按 session_year
  console.log('\n【按届次分布】');
  const years = all('SELECT session_year, COUNT(*) AS c FROM jobs GROUP BY session_year ORDER BY c DESC');
  years.forEach((y) => console.log(`  ${String(y.c).padStart(6)} 条  ${y.session_year || '(空)'}`));

  // 5. 数据质量检查
  console.log('\n【数据质量检查】');
  const emptyCompany = get('SELECT COUNT(*) AS c FROM jobs WHERE company IS NULL OR company = \'\'').c;
  const emptyPosition = get('SELECT COUNT(*) AS c FROM jobs WHERE position IS NULL OR position = \'\'').c;
  const emptySource = get('SELECT COUNT(*) AS c FROM jobs WHERE source IS NULL OR source = \'\'').c;
  const hasDeadline = get('SELECT COUNT(*) AS c FROM jobs WHERE deadline != \'\'').c;
  const hasUrl = get('SELECT COUNT(*) AS c FROM jobs WHERE (official_url != \'\' AND official_url IS NOT NULL) OR (apply_url != \'\' AND apply_url IS NOT NULL)').c;
  console.log(`  公司名为空: ${emptyCompany}`);
  console.log(`  岗位名为空: ${emptyPosition}`);
  console.log(`  来源为空: ${emptySource}`);
  console.log(`  有明确截止日期: ${hasDeadline} (${((hasDeadline / total) * 100).toFixed(1)}%)`);
  console.log(`  有官方/投递链接: ${hasUrl} (${((hasUrl / total) * 100).toFixed(1)}%)`);

  // 6. 各 source 样本抽查（每个源 2 条）
  console.log('\n【各数据源样本抽查】');
  for (const s of sources) {
    const samples = all(
      'SELECT company, position, location, batch, deadline, deadline_text, official_url FROM jobs WHERE source = ? ORDER BY id DESC LIMIT 2',
      [s.source]
    );
    console.log(`\n  ▸ ${s.source}:`);
    samples.forEach((j, i) => {
      const dl = j.deadline || j.deadline_text || '无截止信息';
      const url = j.official_url ? ` [${j.official_url.slice(0, 60)}...]` : '';
      console.log(`    ${i + 1}. ${j.company} | ${j.position} | ${j.location} | ${j.batch} | 截止:${dl}${url}`);
    });
  }

  // 7. 上海地区岗位数（用户画像相关）
  const shanghai = get("SELECT COUNT(*) AS c FROM jobs WHERE location LIKE '%上海%'").c;
  console.log(`\n【上海地区岗位】${shanghai} 条`);

  console.log('\n========== 验证完成 ==========');
}

main();
