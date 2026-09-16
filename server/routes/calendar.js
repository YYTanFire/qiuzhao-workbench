'use strict';
/**
 * 模块 2：今日作战日历 —— 投递计划 + 时间轴视图 + 截止预警
 */
const express = require('express');
const { all, get, run, tx } = require('../db');
const { requireAuth } = require('../auth');
const { buildFilters } = require('./filters');

const router = express.Router();
router.use(requireAuth);

// 预警等级：urgent(≤urgent_days) / warn(≤warn_days) / normal
function levelFor(deadline, daysLeft, settings) {
  if (deadline == null || deadline === '') return 'normal';
  if (daysLeft < 0) return 'expired';
  if (daysLeft <= settings.urgent_days) return 'urgent';
  if (daysLeft <= settings.warn_days) return 'warn';
  return 'normal';
}

function attachLevels(rows, settings) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return rows.map((r) => {
    const dl = r.deadline ? new Date(r.deadline + 'T00:00:00') : null;
    const daysLeft = dl ? Math.round((dl - today) / 86400000) : null;
    return { ...r, days_left: daysLeft, alert_level: levelFor(r.deadline, daysLeft, settings) };
  });
}

// 获取预警阈值设置
router.get('/settings', (req, res) => {
  const s = get('SELECT warn_days, urgent_days FROM user_settings WHERE user_id = ?', [req.user.id]);
  res.json(s || { warn_days: 7, urgent_days: 3 });
});

// 更新预警阈值
router.put('/settings', (req, res) => {
  const { warn_days, urgent_days } = req.body || {};
  const warn = Math.max(1, Math.min(30, Number(warn_days) || 7));
  const urgent = Math.max(0, Math.min(30, Number(urgent_days) || 3));
  run('INSERT INTO user_settings (user_id, warn_days, urgent_days) VALUES (?,?,?) ON CONFLICT(user_id) DO UPDATE SET warn_days=excluded.warn_days, urgent_days=excluded.urgent_days, updated_at=datetime(\'now\',\'localtime\')', [req.user.id, warn, urgent]);
  res.json({ warn_days: warn, urgent_days: urgent });
});

// 我的投递计划（含岗位信息，按截止日期升序；支持飞书式多条件组合筛选）
router.get('/', (req, res) => {
  const { status, filters, logic } = req.query;
  const settings = get('SELECT warn_days, urgent_days FROM user_settings WHERE user_id = ?', [req.user.id]) || { warn_days: 7, urgent_days: 3 };
  const conds = ['a.user_id = ?'];
  const params = [req.user.id];
  if (status && status !== 'all') { conds.push('a.status = ?'); params.push(status); }
  if (filters) {
    const f = buildFilters(filters, logic);
    if (f.where) { conds.push(f.where); params.push(...f.params); }
  }
  const rows = all(
    `SELECT a.id AS application_id, a.status, a.note, a.created_at AS applied_at, j.*
     FROM applications a JOIN jobs j ON j.id = a.job_id
     WHERE ${conds.join(' AND ')} ORDER BY CASE WHEN j.deadline = '' THEN 1 ELSE 0 END, j.deadline ASC, a.id DESC`,
    params
  );
  res.json(attachLevels(rows, settings));
});

// 投递计划多维统计（与列表同一筛选口径）：行业/岗位方向/学历/地点/英语/证书/技能
router.get('/stats', (req, res) => {
  const { filters, logic } = req.query;
  const conds = ['a.user_id = ?'];
  const params = [req.user.id];
  if (filters) {
    const f = buildFilters(filters, logic);
    if (f.where) { conds.push(f.where); params.push(...f.params); }
  }
  const where = `WHERE ${conds.join(' AND ')}`;
  const stat = (expr, limit) => all(
    `SELECT ${expr} AS k, COUNT(*) AS c FROM applications a JOIN jobs j ON j.id = a.job_id ${where} AND ${expr} IS NOT NULL AND ${expr} != '' GROUP BY ${expr} ORDER BY c DESC LIMIT ${limit}`,
    params
  );
  res.json({
    total: get(`SELECT COUNT(*) c FROM applications a JOIN jobs j ON j.id = a.job_id ${where}`, params).c,
    industry: stat('j.industry', 10),
    job_track: stat('j.job_track', 10),
    education: stat('j.education_required', 8),
    location: stat('j.location', 8),
    english: stat('j.english_req', 6),
    cert: stat('j.cert_req', 6),
    skill: stat('j.skill_req', 6),
  });
});

// 清空全部投递计划
router.delete('/all', (req, res) => {
  const n = run('DELETE FROM applications WHERE user_id = ?', [req.user.id]).changes;
  res.json({ ok: true, deleted: n });
});

// 按筛选条件删除投递计划（与列表同一筛选口径）
router.delete('/', (req, res) => {
  const { filters, logic } = req.query;
  const conds = ['a.user_id = ?'];
  const params = [req.user.id];
  if (filters) {
    const f = buildFilters(filters, logic);
    if (f.where) { conds.push(f.where); params.push(...f.params); }
  }
  if (conds.length === 1) return res.status(400).json({ error: '请提供筛选条件' });
  try {
    const n = run(
      `DELETE FROM applications WHERE id IN (SELECT a.id FROM applications a JOIN jobs j ON j.id = a.job_id WHERE ${conds.join(' AND ')})`,
      params
    ).changes;
    res.json({ ok: true, deleted: n });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 加入投递计划
router.post('/', (req, res) => {
  const { job_id } = req.body || {};
  if (!job_id) return res.status(400).json({ error: '缺少岗位 ID' });
  const job = get('SELECT id FROM jobs WHERE id = ?', [job_id]);
  if (!job) return res.status(404).json({ error: '岗位不存在' });
  try {
    const r = run('INSERT OR IGNORE INTO applications (user_id, job_id) VALUES (?, ?)', [req.user.id, job_id]);
    res.json({ ok: true, inserted: r.changes > 0, application_id: r.lastInsertRowid || get('SELECT id FROM applications WHERE user_id = ? AND job_id = ?', [req.user.id, job_id]).id });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 批量加入投递计划（支持按行业列表 或 飞书式筛选条件；仅未过期岗位；幂等跳过已加入）
router.post('/batch', (req, res) => {
  const { industries, filters, logic } = req.body || {};
  const EXPIRED = "(deadline >= date('now','localtime') OR deadline = '')";
  const conds = [EXPIRED];
  const params = [];
  if (Array.isArray(industries) && industries.length) {
    const list = industries.map((x) => String(x).trim()).filter(Boolean);
    if (!list.length) return res.status(400).json({ error: '请提供至少一个行业' });
    conds.push('(' + list.map(() => 'industry LIKE ?').join(' OR ') + ')');
    params.push(...list.map((x) => `%${x}%`));
  }
  if (filters) {
    const f = buildFilters(filters, logic);
    if (f.where) { conds.push(f.where); params.push(...f.params); }
  }
  if (conds.length === 1) return res.status(400).json({ error: '请提供筛选条件' });
  const rows = all(`SELECT id FROM jobs WHERE ${conds.join(' AND ')}`, params);
  try {
    const inserted = tx(() => {
      let n = 0;
      for (const row of rows) {
        const x = run('INSERT OR IGNORE INTO applications (user_id, job_id) VALUES (?, ?)', [req.user.id, row.id]);
        if (x.changes > 0) n++;
      }
      return n;
    });
    res.json({ ok: true, total: rows.length, inserted, skipped: rows.length - inserted });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 简历方向洞察：对筛选后的投递计划聚合岗位方向/技能/专业/英语/证书，给出简历优化建议
router.get('/insights', (req, res) => {
  const { filters, logic } = req.query;
  const conds = ['a.user_id = ?'];
  const params = [req.user.id];
  if (filters) {
    const f = buildFilters(filters, logic);
    if (f.where) { conds.push(f.where); params.push(...f.params); }
  }
  const where = `WHERE ${conds.join(' AND ')}`;
  const rows = all(
    `SELECT j.job_track, j.skill_req, j.req_note, j.major_requirement, j.english_req, j.cert_req
     FROM applications a JOIN jobs j ON j.id = a.job_id ${where}`,
    params
  );

  const countBy = (keyFn, max) => {
    const m = new Map();
    for (const r of rows) {
      const key = keyFn(r);
      if (key) m.set(key, (m.get(key) || 0) + 1);
    }
    return Array.from(m.entries()).map(([k, c]) => ({ k, c })).sort((x, y) => y.c - x.c).slice(0, max);
  };

  // 岗位方向
  const tracks = countBy((r) => (r.job_track && r.job_track.trim()) || '', 8).filter((x) => x.k);

  // 技能短语：从 skill_req / req_note 提取 "熟悉/掌握/精通/熟练使用 + 短语"
  const skillMap = new Map();
  const skillRe = /(?:熟悉|掌握|精通|熟练(?:使用|掌握|操作)?|会使用)[^，。；、\n（(]{2,24}/g;
  for (const r of rows) {
    for (const t of [r.skill_req, r.req_note]) {
      if (!t) continue;
      const ms = String(t).match(skillRe) || [];
      for (const m of ms) {
        const k = m.replace(/^熟悉|^掌握|^精通|^熟练(?:使用|掌握|操作)?|^会使用/, '').trim();
        if (k.length >= 2 && k.length <= 20) skillMap.set(k, (skillMap.get(k) || 0) + 1);
      }
    }
  }
  const skills = Array.from(skillMap.entries()).map(([k, c]) => ({ k, c })).sort((x, y) => y.c - x.c).slice(0, 10);

  // 专业：major_requirement 拆词统计
  const majorMap = new Map();
  const STOP = new Set(['专业', '学历', '要求', '及以上', '相关', '等', '不限', '本科', '硕士', '优先', '相关专业', '按照', '筛选', '岗位']);
  for (const r of rows) {
    if (!r.major_requirement) continue;
    const parts = String(r.major_requirement).split(/[,，、;；/\/\s]+/);
    for (let p of parts) {
      p = p.trim();
      if (p.length < 2 || p.length > 16 || STOP.has(p)) continue;
      if (p.includes('按照') || p.includes('岗位筛选')) continue; // 牛企直聘占位文本，视为不限
      if (/[~～！!?？@#\$%\^&\*()\[\]{}<>、。，；]/.test(p)) continue; // 过滤噪声符号
      majorMap.set(p, (majorMap.get(p) || 0) + 1);
    }
  }
  const majors = Array.from(majorMap.entries()).map(([k, c]) => ({ k, c })).sort((x, y) => y.c - x.c).slice(0, 10);

  // 英语 / 证书
  const english = countBy((r) => (r.english_req && r.english_req.trim()) || '', 5).filter((x) => x.k);
  const cert = countBy((r) => (r.cert_req && r.cert_req.trim()) || '', 5).filter((x) => x.k);

  // 建议文本
  const topTrack = tracks[0];
  const secondTrack = tracks[1];
  const TRACK_HINTS = {
    '测试类': '测试用例设计、自动化测试（Selenium/Appium）、性能/接口测试、缺陷管理',
    '技术支持类': '产品/技术支持、故障排查、客户沟通、Linux/网络基础、文档能力',
    '研发类': '编程语言（C++/Java/Python）、数据结构与算法、项目开发经历',
    '运维类': 'Linux、网络、容器（Docker/K8s）、监控告警、脚本编写',
    '数据类': 'SQL、Python、数据分析、机器学习基础',
    '产品类': '需求分析、原型设计（Axure/Figma）、用户调研',
    '市场销售类': '商务沟通、渠道拓展、客户关系、行业洞察',
    '运营类': '内容/用户运营、数据分析、活动策划',
    '职能类': '办公软件、公文写作、流程管理',
  };
  const sug = [];
  if (topTrack) {
    sug.push(`该筛选范围以「${topTrack.k}」为主（${topTrack.c} 个岗位）${secondTrack ? `，其次「${secondTrack.k}」（${secondTrack.c} 个）` : ''}。`);
  }
  if (skills.length) sug.push(`高频技能要求：${skills.slice(0, 5).map((s) => s.k).join('、')}。`);
  if (majors.length) sug.push(`偏好专业：${majors.slice(0, 5).map((m) => m.k).join('、')}。`);
  if (english.length) sug.push(`英语要求：${english.slice(0, 3).map((e) => e.k).join('；')}。`);
  if (cert.length) sug.push(`证书要求：${cert.slice(0, 3).map((c2) => c2.k).join('；')}。`);
  if (topTrack && TRACK_HINTS[topTrack.k]) sug.push(`「${topTrack.k}」方向可重点准备：${TRACK_HINTS[topTrack.k]}。`);
  sug.push(topTrack
    ? `简历建议：突出「${topTrack.k}」相关项目与经历${skills[0] ? `（如 ${skills.slice(0, 3).map((s) => s.k).join('、')}）` : ''}，个人技能栏按以上关键词对齐，可显著提升命中率。`
    : '当前筛选范围内暂无足够岗位数据生成建议，请调整筛选条件。');

  res.json({ total: rows.length, tracks, skills, majors, english, cert, suggestion: sug.join('\n') });
});

// 更新状态/备注
router.patch('/:id', (req, res) => {
  const { status, note } = req.body || {};
  const exist = get('SELECT id FROM applications WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
  if (!exist) return res.status(404).json({ error: '投递记录不存在' });
  const allowed = ['planned', 'applied', 'written_test', 'interview', 'offer', 'rejected'];
  const sets = [];
  const params = [];
  if (status) {
    if (!allowed.includes(status)) return res.status(400).json({ error: '非法状态' });
    sets.push('status = ?'); params.push(status);
  }
  if (note !== undefined) { sets.push('note = ?'); params.push(note); }
  if (!sets.length) return res.json({ ok: true });
  sets.push("updated_at = datetime('now','localtime')");
  run(`UPDATE applications SET ${sets.join(', ')} WHERE id = ? AND user_id = ?`, [...params, req.params.id, req.user.id]);
  res.json({ ok: true });
});

// 移除投递计划
router.delete('/:id', (req, res) => {
  const r = run('DELETE FROM applications WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
  if (!r.changes) return res.status(404).json({ error: '投递记录不存在' });
  res.json({ ok: true });
});

// 日历统计（今日到期 / 本周 / 预警分布）
router.get('/stats/overview', (req, res) => {
  const settings = get('SELECT warn_days, urgent_days FROM user_settings WHERE user_id = ?', [req.user.id]) || { warn_days: 7, urgent_days: 3 };
  const rows = all('SELECT j.deadline, a.status FROM applications a JOIN jobs j ON j.id = a.job_id WHERE a.user_id = ?', [req.user.id]);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const weekEnd = new Date(today); weekEnd.setDate(weekEnd.getDate() + 7);
  let dueToday = 0, dueWeek = 0, urgent = 0, warn = 0;
  for (const r of rows) {
    if (!r.deadline) continue;
    const dl = new Date(r.deadline + 'T00:00:00');
    const days = Math.round((dl - today) / 86400000);
    if (days === 0) dueToday++;
    if (days >= 0 && days <= 7) dueWeek++;
    if (days <= settings.urgent_days) urgent++;
    else if (days <= settings.warn_days) warn++;
  }
  res.json({ total: rows.length, due_today: dueToday, due_week: dueWeek, urgent, warn });
});

module.exports = router;
