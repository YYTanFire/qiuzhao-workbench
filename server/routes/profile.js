'use strict';
/**
 * 模块 8：智能匹配 —— 基于用户初始简历的行业画像
 * - 保存/读取用户的初始简历
 * - 简历关键词 → 数据库真实行业 匹配打分（内置规则引擎，确定性输出，行业名全部来自库中真实值）
 * - 前端点击推荐行业即可联动岗位雷达筛选
 */
const express = require('express');
const { all, get, run } = require('../db');
const { requireAuth } = require('../auth');
const { extractText } = require('../fileparse');

const router = express.Router();
router.use(requireAuth);

// ==================== 核心行业 → 关键词映射（行业名全部取自数据库真实 industry 值） ====================
// 命中关键词越多，匹配度越高；覆盖主流校招赛道，用户可据此高效收窄投递范围
const CORE_INDUSTRIES = [
  { industry: '电子/通信/半导体', keywords: ['通信', '信号', '5g', '6g', '射频', '芯片', 'ic', '半导体', 'fpga', '集成电路', '电路', '光纤', '传感', '电磁', '微波', '天线', '电子', 'verilog', '数字电路'] },
  { industry: '互联网/人工智能', keywords: ['人工智能', 'ai', '大模型', '机器学习', '深度学习', '算法', '神经网络', 'nlp', '计算机视觉', 'llm', '多模态', '数据挖掘', '智能体', 'transformer', 'pytorch', 'tensorflow', '强化学习'] },
  { industry: 'IT/互联网/游戏', keywords: ['python', 'java', 'c++', 'c语言', '前端', '后端', '开发', '软件', '互联网', '编程', 'golang', '数据库', 'linux', '测试', '游戏', 'unity', '全栈'] },
  { industry: '电子/半导体', keywords: ['芯片', 'ic', '半导体', '集成电路', '版图', 'eda', '封装', '模拟', '数字电路', '射频', 'mcu', 'soc', 'cmos', '工艺'] },
  { industry: '科技', keywords: ['科技', '研发', '研究', '算法', '软件', '硬件', '创新'] },
  { industry: '智能硬件/机器人', keywords: ['嵌入式', '硬件', '机器人', 'mcu', 'arm', '传感器', 'iot', '物联网', '智能硬件', '单片机', 'stm32'] },
  { industry: '通信运营/通信设备', keywords: ['通信', '网络', '运营', '5g', '6g', '基站', '光网络', '传输', '电信', '宽带', '核心网'] },
  { industry: '软件技术', keywords: ['软件', '开发', '编程', '架构', '云', 'saas', 'paas', '后端', '前端', '全栈', '微服务', 'docker'] },
  { industry: '金融业', keywords: ['金融', '银行', '证券', '投资', '风控', '量化', '财务', '审计', '基金', '保险', '估值', '投行'] },
  { industry: '银行/金融', keywords: ['银行', '金融', '信贷', '柜员', '理财', '风控', '网点'] },
  { industry: '金融/证券', keywords: ['证券', '投行', '资管', '研究', '基金', '量化', '交易', '固收'] },
  { industry: '能源/化工/环保', keywords: ['能源', '电力', '化工', '环保', '光伏', '储能', '电池', '电网', '石油', '新能源', '风电'] },
  { industry: '制造业', keywords: ['制造', '工艺', '生产', '质量', '机械', '设备', '材料', '精益', '供应链'] },
  { industry: '车企/汽车零部件', keywords: ['汽车', '整车', '智驾', '自动驾驶', '车联网', '零部件', 'v2x', '座舱', '车载', '电机'] },
  { industry: '机械装备/电气系统', keywords: ['机械', '电气', '自动化', '控制', '电机', '液压', 'plc', '机电', '仿真', 'matlab'] },
  { industry: '医疗/医药/生物', keywords: ['医疗', '医药', '生物', '制药', '临床', 'cro', 'cdmo', '健康', '基因', '细胞'] },
  { industry: '教育/培训/科研', keywords: ['教育', '培训', '科研', '教师', '课程', '研究院', '讲师', '教研'] },
  { industry: '房地产/建筑', keywords: ['建筑', '地产', '土木', '工程', '施工', '设计院', '造价', '结构'] },
  { industry: '消费品', keywords: ['消费', '品牌', '零售', '市场', '营销', '食品', '快消', '电商'] },
  { industry: '专业服务', keywords: ['咨询', '审计', '法律', '人力', 'hr', '顾问', '财务', '税务', '知识产权'] },
  { industry: '游戏', keywords: ['游戏', 'unity', 'ue', '策划', '美术', '动画', '玩法', '引擎'] },
  { industry: '新能源', keywords: ['新能源', '光伏', '储能', '电池', '风电', '氢能', '锂电'] },
  { industry: '高端装备与国防科技/航空航天', keywords: ['航天', '航空', '军工', '国防', '卫星', '导弹', '装备', '无人机'] },
];

// ==================== 简历保存 ====================
function ensureColumn() {
  // 幂等：给 user_settings 增加 base_resume 列（若不存在）
  try { run('ALTER TABLE user_settings ADD COLUMN base_resume TEXT'); } catch { /* already exists */ }
}

// 保存初始简历
router.post('/resume', (req, res) => {
  const { text, raw_files } = req.body || {};
  let content = String(text || '');
  (async () => {
    if (Array.isArray(raw_files) && raw_files.length && !content.trim()) {
      const f = raw_files[0];
      const buf = Buffer.from(f.base64 || '', 'base64');
      if (!buf.length) return res.status(400).json({ error: '文件内容为空' });
      try { content = await extractText(f.name || 'resume.txt', buf); }
      catch (e) { return res.status(400).json({ error: e.message }); }
    }
    if (!content.trim()) return res.status(400).json({ error: '请粘贴简历文本或上传 Word/PDF' });
    ensureColumn();
    run('INSERT INTO user_settings (user_id, base_resume, updated_at) VALUES (?,?,datetime(\'now\',\'localtime\')) ON CONFLICT(user_id) DO UPDATE SET base_resume=excluded.base_resume, updated_at=excluded.updated_at', [req.user.id, content.slice(0, 50000)]);
    res.json({ ok: true, chars: content.length });
  })();
});

// 读取已保存的初始简历
router.get('/resume', (req, res) => {
  ensureColumn();
  const row = get('SELECT base_resume FROM user_settings WHERE user_id = ?', [req.user.id]);
  res.json({ text: (row && row.base_resume) || '' });
});

// ==================== 行业匹配 ====================
// 匹配规则：关键词命中打分 + 数据库真实岗位数佐证；行业名 100% 来自库中真实值
function matchIndustries(text) {
  const raw = String(text || '').toLowerCase();
  const counts = new Map();
  const hits = new Map();
  for (const c of CORE_INDUSTRIES) {
    let score = 0;
    const kws = [];
    for (const kw of c.keywords) {
      if (raw.includes(kw)) { score += 1; kws.push(kw); }
    }
    if (score > 0) { counts.set(c.industry, score); hits.set(c.industry, kws); }
  }
  const maxScore = Math.max(1, ...counts.values());
  const result = [];
  for (const [industry, score] of counts) {
    const row = get("SELECT COUNT(*) c FROM jobs WHERE industry = ? AND (deadline >= date('now','localtime') OR deadline = '')", [industry]);
    result.push({ industry, score, pct: Math.round((score / maxScore) * 100), job_count: row ? row.c : 0, keywords: hits.get(industry) || [] });
  }
  return result.sort((a, b) => b.score - a.score || b.job_count - a.job_count).slice(0, 8);
}

// 生成行业画像（text 缺省时使用已保存简历）
router.post('/industry-match', (req, res) => {
  const { text } = req.body || {};
  let content = String(text || '');
  if (!content.trim()) {
    ensureColumn();
    const row = get('SELECT base_resume FROM user_settings WHERE user_id = ?', [req.user.id]);
    content = (row && row.base_resume) || '';
  }
  if (!content.trim()) return res.status(400).json({ error: '请先提供简历文本（粘贴或上传）' });
  const industries = matchIndustries(content);
  // 附带用户命中的技能摘要（前 60 个高频词元）便于前端展示匹配理由
  res.json({ ok: true, industries, resume_chars: content.length });
});

module.exports = router;
