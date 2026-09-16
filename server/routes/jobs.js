'use strict';
/**
 * 模块 1：岗位雷达 —— 聚合岗位浏览、多维筛选、一键加入投递计划、手动同步
 */
const express = require('express');
const { all, get, run } = require('../db');
const { requireAuth } = require('../auth');
const { runSyncOnce } = require('../sync');

const router = express.Router();
router.use(requireAuth);

// ==================== 飞书式多条件筛选 ====================
// 字段白名单（防注入）；values 多值用 LIKE 集合，单选精确字段用 = 匹配
const FILTER_FIELDS = {
  company_type: 'company_type', industry: 'industry', job_category: 'job_category',
  location: 'location', education_required: 'education_required', batch: 'batch',
  company: 'company', position: 'position', major_requirement: 'major_requirement',
  job_track: 'job_track',
};
const EQ_OPS = new Set(['eq', 'neq']); // 单值精确匹配
const LIKE_OPS = new Set(['contains', 'not_contains', 'in', 'all']); // 模糊/多值匹配

/** 解析 filters 条件数组（JSON）→ { where, params }；非法条件静默跳过 */
function buildFilters(raw, logic) {
  let arr = [];
  try { arr = JSON.parse(raw); } catch { /* ignore */ }
  if (!Array.isArray(arr) || !arr.length) return { where: '', params: [] };
  const conds = [];
  const params = [];
  for (const c of arr) {
    if (!c || typeof c !== 'object' || !FILTER_FIELDS[c.f]) continue;
    const col = FILTER_FIELDS[c.f];
    const op = String(c.op || '');
    if (op === 'empty') { conds.push(`(${col} IS NULL OR ${col} = '')`); continue; }
    if (op === 'not_empty') { conds.push(`(${col} IS NOT NULL AND ${col} != '')`); continue; }
    const vals = Array.isArray(c.v)
      ? c.v.filter((v) => v != null && String(v).trim() !== '')
      : String(c.v ?? '').split(/[,，、\n]/).map((s) => s.trim()).filter(Boolean);
    if (!vals.length) continue;
    if (EQ_OPS.has(op)) {
      conds.push(op === 'eq' ? `${col} = ?` : `(${col} IS NULL OR ${col} != ?)`);
      params.push(vals[0]);
    } else if (LIKE_OPS.has(op)) {
      const glue = op === 'all' ? ' AND ' : ' OR ';
      const neg = op === 'not_contains' ? 'NOT ' : '';
      conds.push(`(${neg}(${vals.map(() => `${col} LIKE ?`).join(glue)}))`);
      vals.forEach((v) => params.push(`%${v}%`));
    }
  }
  const join = logic === 'or' ? ' OR ' : ' AND ';
  return { where: conds.length ? `(${conds.join(join)})` : '', params };
}

// 岗位列表（飞书式多条件筛选；默认只展示未过期岗位，「尽快投递」等无日期岗位保留）
router.get('/', (req, res) => {
  const { company_type, industry, job_category, location, education, keyword, session_year, batch, filters, logic, page = 1, page_size = 24 } = req.query;
  const EXPIRED = "(deadline >= date('now','localtime') OR deadline = '')";
  const conds = [EXPIRED];
  const params = [];
  // 兼容旧的单值参数
  if (company_type) { conds.push('company_type = ?'); params.push(company_type); }
  if (industry) { conds.push('industry = ?'); params.push(industry); }
  if (job_category) { conds.push('job_category = ?'); params.push(job_category); }
  if (location) { conds.push('location LIKE ?'); params.push(`%${location}%`); }
  if (education) { conds.push('education_required = ?'); params.push(education); }
  if (session_year) { conds.push('session_year = ?'); params.push(session_year); }
  if (batch) { conds.push('batch = ?'); params.push(batch); }
  if (keyword) { conds.push('(company LIKE ? OR position LIKE ? OR major_requirement LIKE ?)'); params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`); }
  // 飞书式多条件（与旧参数 AND 叠加）
  if (filters) {
    const f = buildFilters(filters, logic);
    if (f.where) { conds.push(f.where); params.push(...f.params); }
  }
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
  const limit = Math.min(100, Math.max(1, Number(page_size) || 24));
  const offset = (Math.max(1, Number(page) || 1) - 1) * limit;
  const total = get(`SELECT COUNT(*) AS c FROM jobs ${where}`, params).c;
  const rows = all(
    `SELECT j.*, CASE WHEN a.id IS NULL THEN 0 ELSE 1 END AS in_plan
     FROM jobs j LEFT JOIN applications a ON a.job_id = j.id AND a.user_id = ?
     ${where} ORDER BY CASE WHEN j.deadline = '' THEN 1 ELSE 0 END, j.deadline ASC, j.id DESC LIMIT ? OFFSET ?`,
    [req.user.id, ...params, limit, offset]
  );
  res.json({ total, page: Number(page) || 1, page_size: limit, items: rows });
});

// 筛选维度聚合（与列表口径一致：仅未过期岗位）
router.get('/facets', (req, res) => {
  const base = "WHERE (deadline >= date('now','localtime') OR deadline = '') AND ";
  const facet = (col) => all(`SELECT ${col} AS v, COUNT(*) AS c FROM jobs ${base}${col} IS NOT NULL AND ${col} != '' GROUP BY ${col} ORDER BY c DESC LIMIT 20`);
  res.json({
    company_type: facet('company_type'),
    industry: facet('industry'),
    job_category: facet('job_category'),
    job_track: facet('job_track'),
    location: facet('location'),
    education: facet('education_required'),
    batch: facet('batch'),
    session_year: facet('session_year'),
  });
});

// 岗位详情
router.get('/:id', (req, res) => {
  const row = get('SELECT j.*, CASE WHEN a.id IS NULL THEN 0 ELSE 1 END AS in_plan FROM jobs j LEFT JOIN applications a ON a.job_id = j.id AND a.user_id = ? WHERE j.id = ?', [req.user.id, req.params.id]);
  if (!row) return res.status(404).json({ error: '岗位不存在' });
  res.json(row);
});

// 手动触发一次同步
router.post('/sync', async (req, res) => {
  try {
    const r = await runSyncOnce();
    res.json({ ok: true, added: r.added, updated: r.updated, total: r.total, synced_at: r.synced_at });
  } catch (e) {
    res.status(500).json({ error: '同步失败: ' + e.message });
  }
});

module.exports = router;
