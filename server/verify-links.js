'use strict';
/**
 * 链接覆盖率最终验证脚本
 * 用法：node server/verify-links.js
 */
const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const db = new DatabaseSync(path.join(__dirname, '..', 'data', 'qiuzhao.db'));
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA busy_timeout = 20000;');
const all = (sql, params=[]) => db.prepare(sql).all(...params);
const get = (sql, params=[]) => db.prepare(sql).get(...params);

console.log('========== 链接覆盖率最终验证 ==========\n');

const total = get('SELECT COUNT(*) c FROM jobs').c;

// apply_url 总体
const hasApply = get("SELECT COUNT(*) c FROM jobs WHERE apply_url IS NOT NULL AND apply_url != ''").c;
console.log(`【apply_url 投递链接】`);
console.log(`  总体: ${hasApply}/${total} = ${((hasApply/total)*100).toFixed(1)}%`);

// apply_url 按 source
console.log(`  按数据源:`);
all(`SELECT source, COUNT(*) total, SUM(CASE WHEN apply_url IS NOT NULL AND apply_url != '' THEN 1 ELSE 0 END) has FROM jobs GROUP BY source ORDER BY total DESC`)
  .forEach(r => console.log(`    ${String(r.has).padStart(6)}/${String(r.total).padStart(6)} (${((r.has/r.total)*100).toFixed(0)}%)  ${r.source}`));

// apply_url 域名质量
const applyWechat = get("SELECT COUNT(*) c FROM jobs WHERE apply_url LIKE '%mp.weixin.qq.com%'").c;
const applyNonWechat = hasApply - applyWechat;
console.log(`  域名质量: 非微信链接 ${applyNonWechat} (${((applyNonWechat/hasApply)*100).toFixed(0)}%), 微信公众号 ${applyWechat}`);

// company_url 总体
const hasCompany = get("SELECT COUNT(*) c FROM jobs WHERE company_url IS NOT NULL AND company_url != ''").c;
const companiesWithUrl = get("SELECT COUNT(DISTINCT company) c FROM jobs WHERE company_url IS NOT NULL AND company_url != ''").c;
const totalCompanies = get('SELECT COUNT(DISTINCT company) c FROM jobs').c;
console.log(`\n【company_url 公司官网】`);
console.log(`  按岗位条数: ${hasCompany}/${total} = ${((hasCompany/total)*100).toFixed(1)}%`);
console.log(`  按公司数: ${companiesWithUrl}/${totalCompanies} = ${((companiesWithUrl/totalCompanies)*100).toFixed(1)}%`);

// company_url 按 source
console.log(`  按数据源（岗位条数覆盖率）:`);
all(`SELECT source, COUNT(*) total, SUM(CASE WHEN company_url IS NOT NULL AND company_url != '' THEN 1 ELSE 0 END) has FROM jobs GROUP BY source ORDER BY total DESC`)
  .forEach(r => console.log(`    ${String(r.has).padStart(6)}/${String(r.total).padStart(6)} (${((r.has/r.total)*100).toFixed(0)}%)  ${r.source}`));

// 抽样验证
console.log(`\n【抽样：同时有 apply_url + company_url 的岗位（10条）】`);
const samples = all(`SELECT company, position, source, apply_url, company_url FROM jobs WHERE apply_url != '' AND company_url != '' ORDER BY RANDOM() LIMIT 10`);
samples.forEach((s, i) => {
  console.log(`\n  [${i+1}] ${s.company} | ${s.position.slice(0,40)} [${s.source}]`);
  console.log(`      投递: ${s.apply_url.slice(0, 80)}`);
  console.log(`      官网: ${s.company_url.slice(0, 80)}`);
});

// 上海地区覆盖率
const shTotal = get("SELECT COUNT(*) c FROM jobs WHERE location LIKE '%上海%'").c;
const shApply = get("SELECT COUNT(*) c FROM jobs WHERE location LIKE '%上海%' AND apply_url != ''").c;
const shCompany = get("SELECT COUNT(*) c FROM jobs WHERE location LIKE '%上海%' AND company_url != ''").c;
console.log(`\n【上海地区岗位】${shTotal} 条`);
console.log(`  apply_url: ${shApply} (${((shApply/shTotal)*100).toFixed(1)}%)`);
console.log(`  company_url: ${shCompany} (${((shCompany/shTotal)*100).toFixed(1)}%)`);

console.log('\n========== 验证完成 ==========');
db.close();
