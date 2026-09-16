'use strict';
/**
 * 新数据源共享导入工具
 *
 * 所有新增校招数据源的抓取脚本都应复用本模块，保证：
 *   - upsert 逻辑与 sync.js 完全一致（同源更新、跨源不覆盖）
 *   - 批次 / 截止时间 / 岗位分类标准化统一
 *   - source 字段命名规范，页面「数据源分布」可直接展示
 *
 * 用法（在抓取脚本中）：
 *   const { importRows, normalizeBatch, parseDeadline, buildRow } = require('./import-utils');
 *   const rows = fetchedItems.map(item => buildRow({ company, position, ... }));
 *   const result = importRows(rows, '源名称');
 */
const { all, run, tx, db } = require('./db');
const { guessCategory } = require('./ai/service');

const pad = (n) => String(n).padStart(2, '0');

const BATCH_MAP = {
  '秋招': '秋招批',
  '秋招提前批': '提前批',
  '提前批': '提前批',
  '春招': '春招批',
  '春招补录': '补录批',
  '补录': '补录批',
  '秋招补录': '补录批',
  '秋招补招': '补录批',
};

/** 批次文本 → 标准批次（秋招批/提前批/春招批/补录批）；纯实习返回空 */
function normalizeBatch(raw) {
  if (!raw) return '';
  const parts = String(raw).split(/[,，、/／\s]+/).map((s) => s.trim()).filter(Boolean);
  // 优先级：提前批 > 秋招批 > 补录批 > 春招批
  const priority = ['提前批', '秋招', '秋招批', '补录', '补录批', '春招', '春招批'];
  for (const key of priority) {
    for (const p of parts) {
      if (p.includes(key) && !/实习/.test(p)) {
        if (key.includes('提前')) return '提前批';
        if (key.includes('秋招')) return '秋招批';
        if (key.includes('补录') || key.includes('补招')) return '补录批';
        if (key.includes('春招')) return '春招批';
      }
    }
  }
  // 直接映射
  for (const p of parts) {
    if (BATCH_MAP[p]) return BATCH_MAP[p];
  }
  return '';
}

/** 截止时间文本 → { deadline: 'YYYY-MM-DD'|'', deadline_text: 原文 } */
function parseDeadline(raw) {
  const text = String(raw || '').trim();
  if (!text) return { deadline: '', deadline_text: '' };
  // 匹配 2027-10-01 / 2027/10/1 / 2027.10.1
  const m = text.match(/(\d{4})[/\-.年](\d{1,2})[/\-.月](\d{1,2})/);
  if (m) {
    return { deadline: `${m[1]}-${pad(m[2])}-${pad(m[3])}`, deadline_text: '' };
  }
  // 只有月日（如 10月15日），默认当年
  const m2 = text.match(/(\d{1,2})月(\d{1,2})日/);
  if (m2) {
    const year = new Date().getFullYear();
    return { deadline: `${year}-${pad(m2[1])}-${pad(m2[2])}`, deadline_text: '' };
  }
  // 无法解析日期，保留原文（如「尽快投递」「招满为止」）
  return { deadline: '', deadline_text: text.slice(0, 100) };
}

/**
 * 构建标准岗位行。必填：company, position。
 * 可选字段见函数体，未提供则给合理默认值。
 */
function buildRow({
  company,
  position,
  company_type = '',
  industry = '',
  location = '',
  education_required = '',
  salary_min = null,
  salary_max = null,
  deadline_raw = '',
  has_written_test = 0,
  batch_raw = '',
  batch = '',
  major_requirement = '',
  source = '',
  official_url = '',
  apply_url = '',
  company_url = '',
  session_year = '2027',
  is_demo = 0,
  reliable = 1,
}) {
  if (!company || !position) return null;
  const { deadline, deadline_text } = parseDeadline(deadline_raw);
  const finalBatch = batch || normalizeBatch(batch_raw);
  return {
    company: String(company).trim().slice(0, 100),
    position: String(position).trim().replace(/\s+/g, ' ').slice(0, 200),
    company_type: String(company_type || '').trim().slice(0, 40),
    industry: String(industry || '').trim().slice(0, 80),
    job_category: guessCategory(String(position || '')),
    location: String(location || '').trim().slice(0, 80) || '未明确',
    education_required: String(education_required || '').trim().slice(0, 20),
    salary_min: salary_min == null || salary_min === '' ? null : Number(salary_min),
    salary_max: salary_max == null || salary_max === '' ? null : Number(salary_max),
    deadline,
    deadline_text,
    has_written_test: has_written_test ? 1 : 0,
    session_year: String(session_year || '2027'),
    batch: finalBatch,
    major_requirement: String(major_requirement || '').trim().slice(0, 300),
    source: String(source || '').trim(),
    official_url: String(official_url || '').trim().slice(0, 500),
    apply_url: String(apply_url || '').trim().slice(0, 500),
    company_url: String(company_url || '').trim().slice(0, 500),
    is_demo: is_demo ? 1 : 0,
    reliable: reliable ? 1 : 0,
  };
}

/**
 * 多源感知 upsert：与 sync.js 逻辑完全一致
 *   - 同 source 同岗位 → 更新
 *   - 同岗位已由其他 source 提供 → 跳过（不覆盖）
 *   - 否则 → 新增
 */
function upsertJob(r, now) {
  const mine = db.prepare('SELECT id FROM jobs WHERE company = ? AND position = ? AND batch = ? AND session_year = ? AND source = ?')
    .get(r.company, r.position, r.batch, r.session_year, r.source);
  if (mine) {
    db.prepare(`UPDATE jobs SET company_type=?, industry=?, job_category=?, location=?, education_required=?, salary_min=?, salary_max=?, deadline=?, deadline_text=?, has_written_test=?, major_requirement=?, official_url=?, apply_url=?, company_url=?, is_demo=?, reliable=?, synced_at=? WHERE id=?`)
      .run(r.company_type || '', r.industry || '', r.job_category || '', r.location || '', r.education_required || '', r.salary_min, r.salary_max, r.deadline || '', r.deadline_text || '', r.has_written_test || 0, r.major_requirement || '', r.official_url || '', r.apply_url || '', r.company_url || '', r.is_demo || 0, r.reliable || 0, now, mine.id);
    return 'updated';
  }
  const other = db.prepare('SELECT id FROM jobs WHERE company = ? AND position = ? AND batch = ? AND session_year = ?')
    .get(r.company, r.position, r.batch, r.session_year);
  if (other) return 'skipped';
  db.prepare(`INSERT INTO jobs (company, position, company_type, industry, job_category, location, education_required, salary_min, salary_max, deadline, deadline_text, has_written_test, session_year, batch, major_requirement, source, official_url, apply_url, company_url, is_demo, reliable, synced_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(r.company, r.position, r.company_type || '', r.industry || '', r.job_category || '', r.location || '', r.education_required || '', r.salary_min, r.salary_max, r.deadline || '', r.deadline_text || '', r.has_written_test || 0, r.session_year || '2027', r.batch || '', r.major_requirement || '', r.source || '', r.official_url || '', r.apply_url || '', r.company_url || '', r.is_demo || 0, r.reliable || 0, now);
  return 'added';
}

/**
 * 批量导入岗位行（事务包装）。
 * @param {Array} rows - buildRow() 产出的标准行数组
 * @param {string} sourceName - 数据源名称（用于日志和校验）
 * @returns {{added, updated, skipped, total, input}}
 */
function importRows(rows, sourceName) {
  const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
  const valid = rows.filter(Boolean);
  let added = 0, updated = 0, skipped = 0;
  tx(() => {
    for (const r of valid) {
      const st = upsertJob(r, now);
      if (st === 'added') added++;
      else if (st === 'updated') updated++;
      else skipped++;
    }
  });
  const total = all('SELECT COUNT(*) AS c FROM jobs')[0].c;
  console.log(`[导入- ${sourceName}] 输入 ${valid.length} 条 → 新增 ${added}，更新 ${updated}，跳过（跨源重复）${skipped}，当前库共 ${total} 条`);
  return { added, updated, skipped, total, input: valid.length };
}

/** 工具：新源内部去重（同 company+position+batch） */
function dedupWithinSource(rows) {
  const seen = new Set();
  return rows.filter((r) => {
    if (!r) return false;
    const key = `${r.company}|${r.position}|${r.batch || ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

module.exports = {
  importRows,
  upsertJob,
  buildRow,
  normalizeBatch,
  parseDeadline,
  dedupWithinSource,
  guessCategory,
};
