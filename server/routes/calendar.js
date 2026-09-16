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

// 批量加入投递计划（按行业，与岗位雷达口径一致：仅未过期岗位；幂等跳过已加入）
router.post('/batch', (req, res) => {
  const { industries } = req.body || {};
  const list = Array.isArray(industries) ? industries.map((x) => String(x).trim()).filter(Boolean) : [];
  if (!list.length) return res.status(400).json({ error: '请提供至少一个行业' });
  const EXPIRED = "(deadline >= date('now','localtime') OR deadline = '')";
  const ors = list.map(() => 'industry LIKE ?').join(' OR ');
  const params = list.map((x) => `%${x}%`);
  const rows = all(`SELECT id FROM jobs WHERE ${EXPIRED} AND (${ors})`, params);
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
