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

// 岗位列表（多维筛选）
router.get('/', (req, res) => {
  const { company_type, industry, job_category, location, education, keyword, session_year, batch, page = 1, page_size = 24 } = req.query;
  const conds = [];
  const params = [];
  if (company_type) { conds.push('company_type = ?'); params.push(company_type); }
  if (industry) { conds.push('industry = ?'); params.push(industry); }
  if (job_category) { conds.push('job_category = ?'); params.push(job_category); }
  if (location) { conds.push('location LIKE ?'); params.push(`%${location}%`); }
  if (education) { conds.push('education_required = ?'); params.push(education); }
  if (session_year) { conds.push('session_year = ?'); params.push(session_year); }
  if (batch) { conds.push('batch = ?'); params.push(batch); }
  if (keyword) { conds.push('(company LIKE ? OR position LIKE ? OR major_requirement LIKE ?)'); params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`); }
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
  const limit = Math.min(100, Math.max(1, Number(page_size) || 24));
  const offset = (Math.max(1, Number(page) || 1) - 1) * limit;
  const total = get(`SELECT COUNT(*) AS c FROM jobs ${where}`, params).c;
  const rows = all(
    `SELECT j.*, CASE WHEN a.id IS NULL THEN 0 ELSE 1 END AS in_plan
     FROM jobs j LEFT JOIN applications a ON a.job_id = j.id AND a.user_id = ?
     ${where} ORDER BY j.deadline ASC, j.id DESC LIMIT ? OFFSET ?`,
    [req.user.id, ...params, limit, offset]
  );
  res.json({ total, page: Number(page) || 1, page_size: limit, items: rows });
});

// 筛选维度聚合
router.get('/facets', (req, res) => {
  const facet = (col) => all(`SELECT ${col} AS v, COUNT(*) AS c FROM jobs WHERE ${col} IS NOT NULL AND ${col} != '' GROUP BY ${col} ORDER BY c DESC LIMIT 20`);
  res.json({
    company_type: facet('company_type'),
    industry: facet('industry'),
    job_category: facet('job_category'),
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
