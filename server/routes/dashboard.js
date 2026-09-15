'use strict';
/**
 * 总览看板：各模块核心指标聚合
 */
const express = require('express');
const { all, get } = require('../db');
const { requireAuth } = require('../auth');
const { isAiEnabled } = require('../ai/service');

const router = express.Router();
router.use(requireAuth);

router.get('/', (req, res) => {
  const uid = req.user.id;
  const jobsTotal = get('SELECT COUNT(*) AS c FROM jobs').c;
  const jobSources = get('SELECT COUNT(DISTINCT source) AS c FROM jobs WHERE source IS NOT NULL AND source != \'\'').c;
  const apps = all('SELECT status, COUNT(*) AS c FROM applications WHERE user_id = ? GROUP BY status', [uid]);
  const byStatus = Object.fromEntries(apps.map((a) => [a.status, a.c]));
  const planTotal = apps.reduce((s, a) => s + a.c, 0);

  // 未来 7 天截止
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const weekEnd = new Date(today); weekEnd.setDate(weekEnd.getDate() + 7);
  const upcoming = all(
    `SELECT j.id, j.company, j.position, j.deadline FROM applications a JOIN jobs j ON j.id = a.job_id
     WHERE a.user_id = ? AND j.deadline >= ? AND j.deadline <= ? AND a.status != 'rejected'
     ORDER BY j.deadline ASC LIMIT 6`,
    [uid, fmt(today), fmt(weekEnd)]
  );

  const resumes = get('SELECT COUNT(*) AS c FROM resume_versions WHERE user_id = ?', [uid]).c;
  const expCards = get('SELECT COUNT(*) AS c FROM experience_cards WHERE user_id = ?', [uid]).c;
  const interviews = get('SELECT COUNT(*) AS c FROM interview_sessions WHERE user_id = ?', [uid]).c;
  const interviewsWeek = get(`SELECT COUNT(*) AS c FROM interview_sessions WHERE user_id = ? AND created_at >= datetime('now','localtime','-7 day')`, [uid]).c;
  const knowledge = get('SELECT COUNT(*) AS c FROM knowledge_docs WHERE user_id = ?', [uid]).c;

  const todayStr = fmt(new Date());
  const quota = get('SELECT count FROM interview_quota WHERE user_id = ? AND day = ?', [uid, todayStr]);
  const quotaUsed = quota ? quota.count : 0;

  res.json({
    user: req.user,
    ai_enabled: isAiEnabled(),
    jobs: { total: jobsTotal, sources: jobSources },
    plan: { total: planTotal, by_status: byStatus, upcoming },
    assets: { resumes, experience_cards: expCards, interviews, interviews_week: interviewsWeek, knowledge },
    quota: { used: quotaUsed, limit: 3 },
  });
});

function fmt(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

module.exports = router;
