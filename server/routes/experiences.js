'use strict';
/**
 * 模块 4：经历资产 —— 简历自动拆解、AI 教练多轮追问、沉淀到经历卡片
 */
const express = require('express');
const { all, get, run } = require('../db');
const { requireAuth } = require('../auth');
const { extractExperiences, coachRound } = require('../ai/service');
const { extractText } = require('../fileparse');

const router = express.Router();
router.use(requireAuth);

// 解析简历 → 结构化经历卡片
router.post('/parse', async (req, res) => {
  const { resume_text, raw_files } = req.body || {};
  let text = resume_text || '';
  if (Array.isArray(raw_files) && raw_files.length) {
    const f = raw_files[0];
    const buf = Buffer.from(f.base64 || '', 'base64');
    if (!buf.length) return res.status(400).json({ error: '文件内容为空' });
    try { text = await extractText(f.name || 'resume.txt', buf); }
    catch (e) { return res.status(400).json({ error: e.message }); }
  }
  if (!text.trim()) return res.status(400).json({ error: '请提供简历文本或文件' });
  const cards = await extractExperiences(text);
  const inserted = [];
  for (const c of cards) {
    const r = run(
      'INSERT INTO experience_cards (user_id, card_type, title, org, period, content, tags, source_resume) VALUES (?,?,?,?,?,?,?,?)',
      [req.user.id, c.card_type || 'project', c.title || '', c.org || '', c.period || '', JSON.stringify(c.content || []), JSON.stringify(c.tags || []), '初版简历自动拆解']
    );
    inserted.push(r.lastInsertRowid);
  }
  res.json({ inserted: inserted.length, ids: inserted, cards: all('SELECT * FROM experience_cards WHERE user_id = ? ORDER BY id DESC LIMIT ?', [req.user.id, inserted.length]) });
});

// 卡片列表（可按类型筛选）
router.get('/', (req, res) => {
  const { card_type, keyword } = req.query;
  const conds = ['user_id = ?'];
  const params = [req.user.id];
  if (card_type) { conds.push('card_type = ?'); params.push(card_type); }
  if (keyword) { conds.push('(title LIKE ? OR content LIKE ?)'); params.push(`%${keyword}%`, `%${keyword}%`); }
  const rows = all(`SELECT * FROM experience_cards WHERE ${conds.join(' AND ')} ORDER BY id DESC`, params);
  rows.forEach((r) => { r.content = JSON.parse(r.content || '[]'); r.tags = JSON.parse(r.tags || '[]'); });
  res.json(rows);
});

// 手动新增卡片
router.post('/', (req, res) => {
  const { card_type, title, org, period, content, tags } = req.body || {};
  if (!card_type || !title) return res.status(400).json({ error: '类型和标题必填' });
  const r = run(
    'INSERT INTO experience_cards (user_id, card_type, title, org, period, content, tags) VALUES (?,?,?,?,?,?,?)',
    [req.user.id, card_type, title, org || '', period || '', JSON.stringify(Array.isArray(content) ? content : []), JSON.stringify(Array.isArray(tags) ? tags : [])]
  );
  res.json({ id: r.lastInsertRowid });
});

// 更新卡片
router.put('/:id', (req, res) => {
  const exist = get('SELECT id FROM experience_cards WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
  if (!exist) return res.status(404).json({ error: '卡片不存在' });
  const { title, org, period, content, tags, card_type } = req.body || {};
  run(
    "UPDATE experience_cards SET card_type=?, title=?, org=?, period=?, content=?, tags=?, updated_at=datetime('now','localtime') WHERE id=? AND user_id=?",
    [card_type || 'project', title || '', org || '', period || '', JSON.stringify(content || []), JSON.stringify(tags || []), req.params.id, req.user.id]
  );
  res.json({ ok: true });
});

// 删除卡片
router.delete('/:id', (req, res) => {
  const r = run('DELETE FROM experience_cards WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
  if (!r.changes) return res.status(404).json({ error: '卡片不存在' });
  run('DELETE FROM coach_sessions WHERE card_id = ? AND user_id = ?', [req.params.id, req.user.id]);
  res.json({ ok: true });
});

// AI 教练追问：body 无 answer → 开始/继续新一轮（返回 3 题）；有 answer → 记录并进入下一轮
router.post('/:id/coach', async (req, res) => {
  const card = get('SELECT * FROM experience_cards WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
  if (!card) return res.status(404).json({ error: '卡片不存在' });
  const { answer, question } = req.body || {};
  let session = get('SELECT * FROM coach_sessions WHERE card_id = ? AND user_id = ? ORDER BY id DESC LIMIT 1', [req.params.id, req.user.id]);
  if (!session) {
    const r = run('INSERT INTO coach_sessions (user_id, card_id, round, history) VALUES (?,?,1,?)', [req.user.id, req.params.id, '[]']);
    session = get('SELECT * FROM coach_sessions WHERE id = ?', [r.lastInsertRowid]);
  }
  const history = JSON.parse(session.history || '[]');
  if (answer) {
    history.push({ q: question || '', a: answer });
    const nextRound = history.length >= 3 ? session.round + 1 : session.round;
    const done = history.length >= 6; // 2 轮后即可沉淀
    run("UPDATE coach_sessions SET history=?, round=?, updated_at=datetime('now','localtime') WHERE id=?", [JSON.stringify(history), nextRound, session.id]);
    if (done) {
      return res.json({ done: true, round: nextRound, history, can_settle: true, questions: [] });
    }
  }
  const questions = await coachRound(card, history);
  res.json({ done: false, round: session.round, history, questions, can_settle: history.length >= 3 });
});

// 查看追问会话历史
router.get('/:id/coach', (req, res) => {
  const s = get('SELECT * FROM coach_sessions WHERE card_id = ? AND user_id = ? ORDER BY id DESC LIMIT 1', [req.params.id, req.user.id]);
  res.json(s ? { id: s.id, round: s.round, history: JSON.parse(s.history || '[]') } : { history: [] });
});

// 沉淀到经历资产（更新卡片内容，保留原结构只做补充）
router.post('/:id/settle', (req, res) => {
  const card = get('SELECT * FROM experience_cards WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
  if (!card) return res.status(404).json({ error: '卡片不存在' });
  const { content, tags } = req.body || {};
  const merged = Array.isArray(content) ? content : [];
  const oldContent = JSON.parse(card.content || '[]');
  const final = merged.length ? [...oldContent, ...merged.filter((x) => !oldContent.includes(x))] : oldContent;
  run("UPDATE experience_cards SET content=?, tags=?, settled=1, updated_at=datetime('now','localtime') WHERE id=? AND user_id=?",
    [JSON.stringify(final), JSON.stringify(tags || JSON.parse(card.tags || '[]')), req.params.id, req.user.id]);
  res.json({ ok: true, card: { ...card, content: final, settled: 1 } });
});

module.exports = router;
