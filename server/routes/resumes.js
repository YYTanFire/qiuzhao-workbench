'use strict';
/**
 * 模块 3：定制简历 —— 基于通用简历 + 岗位 JD 一键生成定制版
 * 输入支持：文本粘贴 / 上传 Word/PDF（文本提取）
 */
const express = require('express');
const { all, get, run } = require('../db');
const { requireAuth } = require('../auth');
const { generateCustomResume } = require('../ai/service');
const { extractText } = require('../fileparse');

const router = express.Router();
router.use(requireAuth);

// 生成定制简历（demo 模式自动脱敏姓名/电话/邮箱）
function maskPII(text) {
  return String(text || '')
    .replace(/1[3-9]\d{9}/g, '【电话已脱敏】')
    .replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, '【邮箱已脱敏】');
}

function autoTitle(position, company) {
  return `定制简历 · ${position || '目标岗位'}${company ? ' · ' + company : ''}`;
}

router.post('/generate', async (req, res) => {
  const { base_resume, jd, job_id, job_title, company, raw_files } = req.body || {};
  let base = base_resume || '';
  if (Array.isArray(raw_files) && raw_files.length) {
    const f = raw_files[0];
    const buf = Buffer.from(f.base64 || '', 'base64');
    if (!buf.length) return res.status(400).json({ error: '文件内容为空' });
    try {
      base = await extractText(f.name || 'resume.txt', buf);
    } catch (e) {
      return res.status(400).json({ error: e.message });
    }
  }
  if (!base.trim()) return res.status(400).json({ error: '请提供通用版简历（粘贴文本或上传 Word/PDF）' });
  if (!jd || !jd.trim()) return res.status(400).json({ error: '请提供目标岗位 JD' });

  const result = await generateCustomResume(maskPII(base), jd);
  const title = job_title || autoTitle(result.content.head?.intent?.replace('求职意向：', '').trim(), company) || '定制简历';
  const r = run(
    'INSERT INTO resume_versions (user_id, job_id, job_title, title, content_json, score, suggestions, mode) VALUES (?,?,?,?,?,?,?,?)',
    [req.user.id, job_id || null, job_title || null, title, JSON.stringify(result.content), result.score, JSON.stringify(result.suggestions), result.mode]
  );
  res.json({ id: r.lastInsertRowid, ...result, title, job_id: job_id || null, created_at: new Date().toISOString() });
});

// 简历版本库列表
router.get('/', (req, res) => {
  const rows = all('SELECT id, job_id, job_title, title, score, mode, created_at FROM resume_versions WHERE user_id = ? ORDER BY id DESC', [req.user.id]);
  res.json(rows);
});

// 版本详情
router.get('/:id', (req, res) => {
  const row = get('SELECT * FROM resume_versions WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
  if (!row) return res.status(404).json({ error: '版本不存在' });
  row.content = JSON.parse(row.content_json || '{}');
  row.suggestions = JSON.parse(row.suggestions || '[]');
  delete row.content_json;
  res.json(row);
});

// 删除版本
router.delete('/:id', (req, res) => {
  const r = run('DELETE FROM resume_versions WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
  if (!r.changes) return res.status(404).json({ error: '版本不存在' });
  res.json({ ok: true });
});

module.exports = router;
