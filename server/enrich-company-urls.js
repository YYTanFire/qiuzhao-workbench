#!/usr/bin/env node
/**
 * enrich-company-urls.js
 *
 * 为 jobs 表的 company_url 字段补全公司官网/官方招聘链接。
 *
 * 策略（优先级从高到低）：
 *   1. known domains 映射表（data/_known-domains.json）—— 人工/已知域名
 *   2. 从已有 official_url / apply_url 中提取非聚合平台的公司自有链接
 *   3. 已有缓存 data/company-urls.json（断点续跑）
 *
 * 链接来源（均可接受）：
 *   - 公司官网主域名
 *   - 官方招聘系统（mokahr / zhiye / hotjob / nowcoder / 飞书招聘 等）
 *   - 官方公众号文章（mp.weixin.qq.com/s/...）
 *
 * 排除的纯聚合平台：
 *   niuqizp.com / resumemakeroffer.com / wondercv.com / liepin.com /
 *   zhipin.com / 51job.com / lagou.com / kanzhun.com / offerleida.com /
 *   campus2027.top / jobui.com / yingjiesheng.com / shixiseng.com
 *
 * 用法：
 *   node server/enrich-company-urls.js          # 正常运行（读取缓存+计算+写入DB）
 *   node server/enrich-company-urls.js --dry    # 只计算不写DB
 *   node server/enrich-company-urls.js --stats  # 只输出统计
 */

const { DatabaseSync } = require('node:sqlite');
const fs = require('fs');
const path = require('path');

// ─── 配置 ───────────────────────────────────────────────────────────────────
const ROOT = path.join(__dirname, '..');
const DB_PATH = path.join(ROOT, 'data', 'qiuzhao.db');
const KNOWN_DOMAINS_PATH = path.join(ROOT, 'data', '_known-domains.json');
const CACHE_PATH = path.join(ROOT, 'data', 'company-urls.json');
const BATCH_SIZE = 500;

// 纯聚合平台（排除）
const EXCLUDE_DOMAINS = new Set([
  'niuqizp.com',
  'resumemakeroffer.com',
  'wondercv.com',
  'liepin.com',
  'zhipin.com',
  '51job.com',
  'lagou.com',
  'kanzhun.com',
  'offerleida.com',
  'campus2027.top',
  'jobui.com',
  'yingjiesheng.com',
  'shixiseng.com',
  'mshr.com',
  'ganji.com',
  '58.com',
]);

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry');
const STATS_ONLY = args.includes('--stats');

// ─── 工具函数 ───────────────────────────────────────────────────────────────
function isExcludedDomain(hostname) {
  let h = hostname.replace(/^www\./, '').toLowerCase();
  for (const ex of EXCLUDE_DOMAINS) {
    if (h === ex || h.endsWith('.' + ex)) return true;
  }
  return false;
}

function isValidUrl(u) {
  if (!u || typeof u !== 'string') return false;
  if (!u.startsWith('http://') && !u.startsWith('https://')) return false;
  try {
    const parsed = new URL(u);
    return !!parsed.hostname;
  } catch {
    return false;
  }
}

// ─── 主流程 ─────────────────────────────────────────────────────────────────
function main() {
  const db = new DatabaseSync(DB_PATH);
  db.exec('PRAGMA busy_timeout = 30000');

  // 1. 加载已知域名
  const knownDomains = JSON.parse(fs.readFileSync(KNOWN_DOMAINS_PATH, 'utf8'));
  console.log(`[1/5] 已知域名映射: ${Object.keys(knownDomains).length} 条`);

  // 2. 加载已有缓存
  let cache = {};
  if (fs.existsSync(CACHE_PATH)) {
    cache = JSON.parse(fs.readFileSync(CACHE_PATH, 'utf8'));
    console.log(`[2/5] 已有缓存: ${Object.keys(cache).length} 条`);
  } else {
    console.log(`[2/5] 无缓存文件，从头开始`);
  }

  // 3. 从数据库提取所有公司及其 URL
  const companies = db.prepare(`
    SELECT company,
      COUNT(*) AS cnt,
      GROUP_CONCAT(DISTINCT official_url) AS off_urls,
      GROUP_CONCAT(DISTINCT apply_url) AS app_urls
    FROM jobs
    GROUP BY company
    ORDER BY cnt DESC
  `).all();
  console.log(`[3/5] 数据库中去重公司: ${companies.length} 家`);

  // 4. 为每家公司确定 company_url
  const finalMapping = { ...cache };
  let fromKnown = 0, fromUrlExtract = 0, fromCache = 0, skipped = 0;

  for (const row of companies) {
    // 已有缓存且有效，跳过
    if (finalMapping[row.company] && isValidUrl(finalMapping[row.company])) {
      fromCache++;
      continue;
    }

    // a. 已知域名
    if (knownDomains[row.company]) {
      if (isValidUrl(knownDomains[row.company])) {
        finalMapping[row.company] = knownDomains[row.company];
        fromKnown++;
        continue;
      }
    }

    // b. 从已有 official_url / apply_url 提取
    const urls = [];
    if (row.off_urls) row.off_urls.split(',').forEach(u => { if (u) urls.push(u.trim()); });
    if (row.app_urls) row.app_urls.split(',').forEach(u => { if (u) urls.push(u.trim()); });

    let extracted = null;
    for (const u of urls) {
      if (!isValidUrl(u)) continue;
      try {
        const parsed = new URL(u);
        if (!isExcludedDomain(parsed.hostname)) {
          extracted = u;
          break;
        }
      } catch { /* skip */ }
    }

    if (extracted) {
      finalMapping[row.company] = extracted;
      fromUrlExtract++;
    } else {
      skipped++;
    }
  }

  console.log(`[4/5] 映射结果:`);
  console.log(`  来自缓存: ${fromCache}`);
  console.log(`  来自已知域名: ${fromKnown}`);
  console.log(`  来自已有URL提取: ${fromUrlExtract}`);
  console.log(`  仍无链接: ${skipped}`);

  // 统计覆盖率
  let coveredJobs = 0;
  for (const row of companies) {
    if (finalMapping[row.company]) coveredJobs += row.cnt;
  }
  const totalJobs = companies.reduce((s, r) => s + r.cnt, 0);
  console.log(`  覆盖岗位: ${coveredJobs} / ${totalJobs} (${(coveredJobs / totalJobs * 100).toFixed(1)}%)`);
  console.log(`  目标 (70%): ${Math.round(totalJobs * 0.7)}`);

  // 保存缓存
  fs.writeFileSync(CACHE_PATH, JSON.stringify(finalMapping, null, 2));
  console.log(`  缓存已保存: data/company-urls.json (${Object.keys(finalMapping).length} 条)`);

  if (STATS_ONLY) {
    db.close();
    return;
  }

  // 5. 批量 UPDATE
  if (DRY_RUN) {
    console.log(`\n[DRY RUN] 跳过数据库写入`);
    db.close();
    return;
  }

  console.log(`\n[5/5] 开始批量 UPDATE...`);
  const updateStmt = db.prepare(
    "UPDATE jobs SET company_url = ? WHERE company = ? AND (company_url IS NULL OR company_url = '')"
  );

  let totalUpdated = 0;
  const entries = Object.entries(finalMapping).filter(([, url]) => isValidUrl(url));
  console.log(`  待更新公司数: ${entries.length}`);

  // 分批事务
  for (let i = 0; i < entries.length; i += BATCH_SIZE) {
    const batch = entries.slice(i, i + BATCH_SIZE);
    db.exec('BEGIN TRANSACTION');
    try {
      for (const [company, url] of batch) {
        const result = updateStmt.run(url, company);
        totalUpdated += result.changes;
      }
      db.exec('COMMIT');
      process.stdout.write(`\r  进度: ${Math.min(i + BATCH_SIZE, entries.length)}/${entries.length} 公司, ${totalUpdated} 条岗位已更新`);
    } catch (e) {
      db.exec('ROLLBACK');
      console.error(`\n  批次 ${i} 失败:`, e.message);
    }
  }
  console.log(`\n  完成！共更新 ${totalUpdated} 条岗位记录`);

  // 最终统计
  const finalStats = db.prepare(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN company_url IS NOT NULL AND company_url != '' THEN 1 ELSE 0 END) AS with_url
    FROM jobs
  `).get();
  console.log(`\n最终覆盖率:`);
  console.log(`  有 company_url 的岗位: ${finalStats.with_url} / ${finalStats.total} (${(finalStats.with_url / finalStats.total * 100).toFixed(1)}%)`);

  db.close();
}

main();
