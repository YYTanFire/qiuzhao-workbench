'use strict';
/**
 * 模块 6：知识库 —— 录入（文本/文件/链接/图片OCR）、分类归档、搜索、AI 问答
 */
const express = require('express');
const { all, get, run } = require('../db');
const { requireAuth } = require('../auth');
const { askKnowledge, ocrImage } = require('../ai/service');
const { extractText } = require('../fileparse');

const router = express.Router();
router.use(requireAuth);

// 列表（分类筛选 + 关键词搜索）
router.get('/', (req, res) => {
  const { industry, company, module, keyword } = req.query;
  const conds = ['user_id = ?'];
  const params = [req.user.id];
  if (industry) { conds.push('industry = ?'); params.push(industry); }
  if (company) { conds.push('company = ?'); params.push(company); }
  if (module) { conds.push('module = ?'); params.push(module); }
  if (keyword) { conds.push('(title LIKE ? OR content LIKE ?)'); params.push(`%${keyword}%`, `%${keyword}%`); }
  const rows = all(`SELECT id, title, doc_type, industry, company, module, source, created_at FROM knowledge_docs WHERE ${conds.join(' AND ')} ORDER BY id DESC`, params);
  const facets = {
    industry: all('SELECT DISTINCT industry FROM knowledge_docs WHERE user_id = ? AND industry IS NOT NULL AND industry != ?', [req.user.id, '']).map((r) => r.industry),
    company: all('SELECT DISTINCT company FROM knowledge_docs WHERE user_id = ? AND company IS NOT NULL AND company != ?', [req.user.id, '']).map((r) => r.company),
    module: all('SELECT DISTINCT module FROM knowledge_docs WHERE user_id = ? AND module IS NOT NULL AND module != ?', [req.user.id, '']).map((r) => r.module),
  };
  res.json({ items: rows, facets });
});

// 录入：text / file / link / image
router.post('/import', async (req, res) => {
  const { type = 'text', title, content, industry, company, module, source, raw_file, link_url, image_data_url } = req.body || {};
  let body = '';
  let finalTitle = (title || '').trim();
  let docType = type;

  try {
    if (type === 'text') {
      body = String(content || '');
      if (!finalTitle) finalTitle = '手动笔记 ' + new Date().toLocaleDateString('zh-CN');
    } else if (type === 'file') {
      if (!raw_file || !raw_file.base64) return res.status(400).json({ error: '缺少文件内容' });
      const buf = Buffer.from(raw_file.base64, 'base64');
      body = await extractText(raw_file.name || 'file.txt', buf);
      if (!finalTitle) finalTitle = raw_file.name.replace(/\.[^.]+$/, '');
      docType = (raw_file.name || '').split('.').pop().toLowerCase();
    } else if (type === 'link') {
      if (!link_url) return res.status(400).json({ error: '缺少链接' });
      const resp = await fetch(link_url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
      if (!resp.ok) return res.status(400).json({ error: `链接抓取失败 (${resp.status})` });
      const html = await resp.text();
      body = String(html)
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 12000);
      if (!finalTitle) {
        const m = html.match(/<title[^>]*>([^<]+)<\/title>/i);
        finalTitle = (m ? m[1].trim() : link_url).slice(0, 60);
      }
      if (!source) source = link_url;
    } else if (type === 'image') {
      if (!image_data_url) return res.status(400).json({ error: '缺少图片' });
      const ocrText = await ocrImage(image_data_url);
      if (ocrText == null) return res.status(400).json({ error: '图片 OCR 需要配置视觉模型 API（AI_API_KEY + AI_VISION_MODEL），或改用文本/文件方式录入' });
      body = ocrText;
      if (!finalTitle) finalTitle = '图片资料 ' + new Date().toLocaleDateString('zh-CN');
    } else {
      return res.status(400).json({ error: '未知录入类型' });
    }
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }

  if (!body.trim()) return res.status(400).json({ error: '未能提取到有效内容' });
  const r = run(
    'INSERT INTO knowledge_docs (user_id, title, doc_type, industry, company, module, content, source) VALUES (?,?,?,?,?,?,?,?)',
    [req.user.id, finalTitle.slice(0, 100), docType, industry || '', company || '', module || '', body.slice(0, 60000), source || '']
  );
  res.json({ id: r.lastInsertRowid, title: finalTitle, chars: body.length });
});

// 手动新增（结构化）
router.post('/', (req, res) => {
  const { title, content, industry, company, module, source } = req.body || {};
  if (!title || !content) return res.status(400).json({ error: '标题和内容必填' });
  const r = run(
    'INSERT INTO knowledge_docs (user_id, title, doc_type, industry, company, module, content, source) VALUES (?,?,?,?,?,?,?,?)',
    [req.user.id, String(title).slice(0, 100), 'manual', industry || '', company || '', module || '', String(content).slice(0, 60000), source || '']
  );
  res.json({ id: r.lastInsertRowid });
});

// 详情
router.get('/:id', (req, res) => {
  const row = get('SELECT * FROM knowledge_docs WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
  if (!row) return res.status(404).json({ error: '资料不存在' });
  res.json(row);
});

// 删除
router.delete('/:id', (req, res) => {
  const r = run('DELETE FROM knowledge_docs WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
  if (!r.changes) return res.status(404).json({ error: '资料不存在' });
  res.json({ ok: true });
});

// AI 问答（检索知识库后回答）
router.post('/ask', async (req, res) => {
  const { question } = req.body || {};
  if (!question || !String(question).trim()) return res.status(400).json({ error: '请输入问题' });
  const docs = all('SELECT title, content FROM knowledge_docs WHERE user_id = ? ORDER BY id DESC LIMIT 200', [req.user.id]);
  const answer = await askKnowledge(String(question), docs);
  res.json({ answer, sources: docs.slice(0, 8).map((d) => d.title) });
});

module.exports = router;
