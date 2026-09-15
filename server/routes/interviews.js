'use strict';
/**
 * 模块 5：面试作战 —— 面试题预测 / AI 模拟面试（每日限 3 次）/ 面试复盘
 */
const express = require('express');
const { all, get, run } = require('../db');
const { requireAuth } = require('../auth');
const { predictQuestions, scoreInterviewAnswer, analyzeInterview, guessCategory } = require('../ai/service');

const router = express.Router();
router.use(requireAuth);

const DAY_LIMIT = 3;

function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function flattenBank(bank) {
  return [
    ...(bank.behavior || []).map((q) => ({ ...q, group: '行为面' })),
    ...(bank.professional || []).map((q) => ({ ...q, group: '专业面' })),
    ...(bank.hr || []).map((q) => ({ ...q, group: 'HR 面' })),
    ...(bank.company || []).map((q) => ({ ...q, group: '公司专属' })),
  ];
}

// 面试题预测（不消耗配额）
router.post('/predict', async (req, res) => {
  const { jd, company, category } = req.body || {};
  if (!jd || !jd.trim()) return res.status(400).json({ error: '请提供岗位 JD' });
  const bank = await predictQuestions(jd, category);
  res.json({ bank, company: company || '', category: guessCategory(jd) });
});

// 创建模拟面试（每日 3 次配额）
router.post('/sessions', async (req, res) => {
  const { jd, company, job_id, job_title, question_bank } = req.body || {};
  if (!jd && !question_bank) return res.status(400).json({ error: '请提供岗位 JD 或题库' });
  const day = today();
  const quota = get('SELECT count FROM interview_quota WHERE user_id = ? AND day = ?', [req.user.id, day]);
  const used = quota ? quota.count : 0;
  if (used >= DAY_LIMIT) return res.status(429).json({ error: `今日模拟面试次数已达上限（${DAY_LIMIT} 次），明天再来` });
  const bank = question_bank || await predictQuestions(jd);
  const flat = flattenBank(bank);
  if (!flat.length) return res.status(400).json({ error: '题库为空' });
  const r = run(
    'INSERT INTO interview_sessions (user_id, job_id, job_title, company, rounds_json, current_question, answers_json) VALUES (?,?,?,?,?,0,?)',
    [req.user.id, job_id || null, job_title || null, company || '', JSON.stringify(flat), '[]']
  );
  run('INSERT INTO interview_quota (user_id, day, count) VALUES (?,?,1) ON CONFLICT(user_id, day) DO UPDATE SET count = count + 1', [req.user.id, day]);
  res.json({ id: r.lastInsertRowid, used: used + 1, limit: DAY_LIMIT, total_questions: flat.length });
});

// 会话进度（当前题目）
router.get('/sessions/:id', (req, res) => {
  const s = get('SELECT * FROM interview_sessions WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
  if (!s) return res.status(404).json({ error: '会话不存在' });
  const rounds = JSON.parse(s.rounds_json || '[]');
  const answers = JSON.parse(s.answers_json || '[]');
  const current = s.current_question;
  res.json({
    id: s.id, company: s.company, job_title: s.job_title, status: s.status, mode: s.mode || 'builtin',
    total: rounds.length, answered: answers.length, current_index: current,
    current_question: current < rounds.length ? rounds[current] : null,
    rounds: rounds, answers,
  });
});

// 提交答案 → 评分 + 推进；全部答完生成复盘报告
router.post('/sessions/:id/answer', async (req, res) => {
  const s = get('SELECT * FROM interview_sessions WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
  if (!s) return res.status(404).json({ error: '会话不存在' });
  if (s.status === 'finished') return res.status(400).json({ error: '会话已结束' });
  const { answer } = req.body || {};
  if (!answer || !String(answer).trim()) return res.status(400).json({ error: '请先作答' });
  const rounds = JSON.parse(s.rounds_json || '[]');
  const answers = JSON.parse(s.answers_json || '[]');
  const idx = s.current_question;
  if (idx >= rounds.length) return res.status(400).json({ error: '题目已答完' });
  const q = rounds[idx];
  const scored = await scoreInterviewAnswer(q.q, answer, s.job_title ? '' : '');
  answers.push({ ...q, answer: String(answer), score: scored.score, feedback: scored.feedback || '', missed: scored.missed || [], tips: scored.tips || [] });
  const finished = idx + 1 >= rounds.length;
  let score = null, report = null;
  if (finished) {
    score = Math.round(answers.reduce((sum, a) => sum + (a.score || 0), 0) / answers.length);
    const weakGroups = {};
    answers.forEach((a) => { if ((a.score || 0) < 60) { weakGroups[a.group] = (weakGroups[a.group] || 0) + 1; } });
    const weakItems = Object.entries(weakGroups).map(([g, c]) => `${g} ${c} 题低于 60 分`).join('；') || '无明显薄弱模块';
    report = {
      overall: score,
      summary: `本轮共回答 ${answers.length} 题，平均分 ${score}。${weakItems}。建议针对薄弱模块补充案例与数据，并把高频问题整理进知识库。`,
      weak: Object.keys(weakGroups),
      byGroup: Object.entries(answers.reduce((m, a) => { m[a.group] = m[a.group] || []; m[a.group].push(a.score); return m; }, {})).map(([g, arr]) => ({ group: g, avg: Math.round(arr.reduce((x, y) => x + y, 0) / arr.length), count: arr.length })),
      low_questions: answers.filter((a) => (a.score || 0) < 60).map((a) => ({ question: a.q, score: a.score })),
    };
  }
  run("UPDATE interview_sessions SET current_question=?, answers_json=?, score=?, report=?, status=?, mode=? WHERE id=?",
    [idx + 1, JSON.stringify(answers), score, report ? JSON.stringify(report) : null, finished ? 'finished' : 'ongoing', s.mode || 'builtin', s.id]);
  res.json({ answered: answers.length, total: rounds.length, finished, score: scored.score, feedback: scored.feedback, missed: scored.missed || [], tips: scored.tips || [], next_question: !finished ? rounds[idx + 1] : null });
});

// 复盘报告
router.get('/sessions/:id/report', (req, res) => {
  const s = get('SELECT * FROM interview_sessions WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
  if (!s) return res.status(404).json({ error: '会话不存在' });
  const answers = JSON.parse(s.answers_json || '[]');
  res.json({
    id: s.id, status: s.status, score: s.score, company: s.company, job_title: s.job_title,
    report: s.report ? JSON.parse(s.report) : null,
    answers: answers.map(({ q, group, answer, score, feedback }) => ({ q, group, answer, score, feedback })),
  });
});

// 模拟面试历史
router.get('/sessions', (req, res) => {
  const rows = all('SELECT id, company, job_title, current_question, score, status, mode, created_at FROM interview_sessions WHERE user_id = ? ORDER BY id DESC', [req.user.id]);
  rows.forEach((r) => { const n = get('SELECT json_array_length(rounds_json) AS c FROM interview_sessions WHERE id = ?', [r.id]); r.total = n ? n.c : 0; });
  res.json(rows);
});

// 面试复盘：导入录音转文字 / 手动添加
router.post('/reviews', async (req, res) => {
  const { transcript, job_id, job_title, company } = req.body || {};
  if (!transcript || !String(transcript).trim()) return res.status(400).json({ error: '请提供面试对话文本' });
  const analysis = await analyzeInterview(String(transcript));
  const r = run(
    'INSERT INTO interview_reviews (user_id, job_id, job_title, company, transcript, analysis) VALUES (?,?,?,?,?,?)',
    [req.user.id, job_id || null, job_title || null, company || '', String(transcript), JSON.stringify(analysis)]
  );
  res.json({ id: r.lastInsertRowid, analysis });
});

// 复盘列表
router.get('/reviews', (req, res) => {
  const rows = all('SELECT id, job_id, job_title, company, created_at, analysis FROM interview_reviews WHERE user_id = ? ORDER BY id DESC', [req.user.id]);
  rows.forEach((r) => { r.analysis = JSON.parse(r.analysis || '{}'); });
  res.json(rows);
});

// 删除复盘
router.delete('/reviews/:id', (req, res) => {
  const r = run('DELETE FROM interview_reviews WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
  if (!r.changes) return res.status(404).json({ error: '复盘不存在' });
  res.json({ ok: true });
});

// 看板速览
router.get('/dashboard', (req, res) => {
  const day = today();
  const total = get('SELECT COUNT(*) AS c FROM interview_sessions WHERE user_id = ?', [req.user.id]).c;
  const weekStart = new Date(); weekStart.setHours(0, 0, 0, 0); weekStart.setDate(weekStart.getDate() - weekStart.getDay() + 1);
  const week = get('SELECT COUNT(*) AS c FROM interview_sessions WHERE user_id = ? AND created_at >= ?', [req.user.id, weekStart.toISOString().slice(0, 19).replace('T', ' ')]).c;
  const finished = all('SELECT score FROM interview_sessions WHERE user_id = ? AND status = \'finished\' AND score IS NOT NULL', [req.user.id]);
  const passRate = finished.length ? Math.round((finished.filter((s) => s.score >= 70).length / finished.length) * 100) : null;
  const quota = get('SELECT count FROM interview_quota WHERE user_id = ? AND day = ?', [req.user.id, day]);
  const reviews = get('SELECT COUNT(*) AS c FROM interview_reviews WHERE user_id = ?', [req.user.id]).c;
  res.json({ total, week, pass_rate: passRate, reviews, quota_used: quota ? quota.count : 0, quota_limit: DAY_LIMIT });
});

module.exports = router;
