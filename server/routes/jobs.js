'use strict';
/**
 * 模块 1：岗位雷达 —— 聚合岗位浏览、多维筛选、一键加入投递计划、手动同步
 */
const express = require('express');
const { all, get, run } = require('../db');
const { requireAuth } = require('../auth');
const { runSyncOnce } = require('../sync');
const { FILTER_FIELDS, buildFilters } = require('./filters');

const router = express.Router();
router.use(requireAuth);

// ==================== 飞书式多条件筛选（逻辑见 filters.js） ====================

// 文字需求解析：把用户描述转成可应用的筛选条件（行业/岗位方向/技能专业关键词）
// 关键词全部来自库中真实行业值/方向值拆分，宁缺毋假
router.post('/parse-intent', (req, res) => {
  const { text } = req.body || {};
  const t = String(text || '').trim();
  if (t.length < 2) return res.status(400).json({ error: '请先输入你的经历或需求描述' });
  const EXPIRED = "(deadline >= date('now','localtime') OR deadline = '')";

  // 1. 行业：库中真实行业值拆分关键词 + 预置别名映射（别名指向的值必须存在于库中），按命中数取 top3
  const industryRows = all('SELECT DISTINCT industry FROM jobs WHERE industry != \'\'');
  const industryValues = new Set(industryRows.map((r) => r.industry));
  const ALIAS = {
    '光纤': '电子/通信/半导体', '传感': '电子/通信/半导体', '光电': '电子/通信/半导体', '光电子': '电子/通信/半导体',
    '芯片': '电子/通信/半导体', '集成电路': '电子/通信/半导体', '半导体': '电子/通信/半导体', '5G': '电子/通信/半导体',
    '通信': '电子/通信/半导体', '电信': '电子/通信/半导体', '信号': '电子/通信/半导体', '电子': '电子/通信/半导体',
    '人工智能': '互联网/人工智能', 'AI': '互联网/人工智能', '大模型': '互联网/人工智能', '智能': '互联网/人工智能', '机器学习': '互联网/人工智能',
    '互联网': 'IT/互联网/游戏', '软件': 'IT/互联网/游戏', '游戏': 'IT/互联网/游戏', '电商': 'IT/互联网/游戏', '云计算': 'IT/互联网/游戏',
    '新能源': '能源/化工/环保', '能源': '能源/化工/环保', '电力': '能源/化工/环保', '化工': '能源/化工/环保', '环保': '能源/化工/环保',
    '汽车': '制造业', '机械': '制造业', '装备': '制造业', '制造': '制造业', '工业': '制造业', '自动化': '制造业',
    '航天': '高端装备与国防科技/航空航天', '航空': '高端装备与国防科技/航空航天', '国防': '高端装备与国防科技/航空航天', '军工': '高端装备与国防科技/航空航天',
    '银行': '金融/银行/保险', '金融': '金融/银行/保险', '保险': '金融/银行/保险', '证券': '金融/银行/保险',
    '医疗': '医疗/健康', '医药': '医疗/健康', '生物': '医疗/健康', '健康': '医疗/健康',
    '教育': '教育/培训/科研', '培训': '教育/培训/科研', '科研': '教育/培训/科研',
    '物流': '交通/物流/仓储', '交通': '交通/物流/仓储', '供应链': '交通/物流/仓储', '仓储': '交通/物流/仓储',
    '贸易': '贸易/批发/零售', '零售': '贸易/批发/零售', '消费': '贸易/批发/零售', '快消': '贸易/批发/零售',
    '建筑': '建筑/房地产', '地产': '建筑/房地产', '土木': '建筑/房地产',
    '农业': '农林牧渔', '食品': '食品饮料',
  };
  const industryHits = [];
  for (const r of industryRows) {
    const segs = String(r.industry).split(/[/／、,，\s]+/).filter((s) => s.length >= 2);
    let hit = 0; const kws = [];
    for (const s of segs) {
      if (t.includes(s)) { hit++; kws.push(s); }
    }
    if (hit) industryHits.push({ v: r.industry, hit, kws });
  }
  for (const [kw, ind] of Object.entries(ALIAS)) {
    if (t.includes(kw) && industryValues.has(ind)) {
      const ex = industryHits.find((x) => x.v === ind);
      if (ex) { ex.hit++; ex.kws.push(kw); }
      else industryHits.push({ v: ind, hit: 1, kws: [kw] });
    }
  }
  industryHits.sort((a, b) => b.hit - a.hit);
  const industry = industryHits[0] ? {
    f: 'industry', op: 'in', v: [industryHits[0].v],
    label: '行业', reason: `文字含「${industryHits[0].kws.join('、')}」`,
    count: get(`SELECT COUNT(*) c FROM jobs WHERE ${EXPIRED} AND industry LIKE ?`, [`%${industryHits[0].v}%`]).c,
  } : null;

  // 2. 岗位方向：方向关键词映射，返回命中的全部（≤3）
  const TRACK_KW = [
    ['测试类', ['测试', 'QA', '质量保证', '测开']],
    ['研发类', ['研发', '开发', '算法', '编程', '代码', '软件工程', '后端', '前端', '嵌入式']],
    ['技术支持类', ['技术支', '售后', '实施', '解决方案', '技术支持']],
    ['运维类', ['运维', '网络管理', '系统管理']],
    ['数据类', ['数据分析', '大数据', '数据挖掘']],
    ['产品类', ['产品经理', '产品设计']],
    ['运营类', ['运营']],
    ['市场销售类', ['市场', '销售', '商务', '客户经理']],
    ['职能类', ['人力', '财务', '行政', '法务', '职能']],
    ['数据标注类', ['标注']],
  ];
  const trackHits = [];
  for (const [track, kws] of TRACK_KW) {
    const hitKw = kws.filter((k) => t.includes(k));
    if (hitKw.length) trackHits.push({
      f: 'job_track', op: 'in', v: [track], label: '岗位方向',
      reason: `文字含「${hitKw.join('、')}」`,
      count: get(`SELECT COUNT(*) c FROM jobs WHERE ${EXPIRED} AND job_track LIKE ?`, [`%${track}%`]).c,
    });
  }
  trackHits.sort((a, b) => b.count - a.count);
  const tracks = trackHits.slice(0, 3);

  // 3. 技能/专业关键词：预置常见词表，命中即生成 专业要求 条件（包含任意，宁缺毋假）
  const SKILL_KW = ['Python', 'C++', 'Java', 'C语言', 'FPGA', 'Verilog', 'MATLAB', '深度学习', '机器学习', '人工智能', '大模型', '嵌入式', '通信', '自动化', '机械', '电气', '计算机', '软件工程', '电子信息', '集成电路', '物联网', '网络安全', '数据分析', 'SQL', '前端', '后端', '硬件', '软件测试', '算法', '机器人', '电力', '能源', '光电', '信号处理', '光纤', '传感', '测试用例', '渗透', '安全'];
  const kwHits = SKILL_KW.filter((k) => t.includes(k)).slice(0, 5);
  const majors = kwHits.length ? {
    f: 'major_requirement', op: 'in', v: kwHits,
    label: '专业/技能', reason: `文字含「${kwHits.join('、')}」`,
    count: get(`SELECT COUNT(*) c FROM jobs WHERE ${EXPIRED} AND (${kwHits.map(() => '(major_requirement LIKE ? OR position LIKE ?)').join(' OR ')})`, kwHits.flatMap((k) => [`%${k}%`, `%${k}%`])).c,
  } : null;

  res.json({ industry, tracks, majors, text: t });
});

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
