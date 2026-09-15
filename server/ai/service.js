'use strict';
/**
 * AI 服务层
 * - 配置 AI_API_KEY 后：走 OpenAI 兼容 Chat Completions API（文本生成 + 视觉理解）
 * - 未配置时：使用内置演示引擎（规则 + 模板），保证产品全流程可跑通
 * 页面会明确展示当前处于「真实 AI」还是「内置演示」模式，不宣称官方合作。
 */
const fs = require('node:fs');
const path = require('node:path');

const API_KEY = process.env.AI_API_KEY || '';
const BASE_URL = (process.env.AI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '');
const MODEL = process.env.AI_MODEL || 'gpt-4o-mini';
const VISION_MODEL = process.env.AI_VISION_MODEL || MODEL;

function isAiEnabled() {
  return Boolean(API_KEY);
}

/** 通用对话补全（OpenAI 兼容） */
async function chat(messages, { maxTokens = 1200, temperature = 0.7, model } = {}) {
  if (!isAiEnabled()) throw new Error('AI 未配置');
  const resp = await fetch(`${BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${API_KEY}` },
    body: JSON.stringify({ model: model || MODEL, messages, max_tokens: maxTokens, temperature }),
  });
  if (!resp.ok) {
    const err = await resp.text().catch(() => '');
    throw new Error(`AI API 请求失败 (${resp.status}): ${err.slice(0, 200)}`);
  }
  const data = await resp.json();
  return data.choices?.[0]?.message?.content ?? '';
}

/** 尝试用真实 AI 生成 JSON，失败或未配置时回退内置引擎 */
async function aiJson(fnName, builtinFn, promptMessages, { maxTokens = 1500 } = {}) {
  if (isAiEnabled()) {
    try {
      const raw = await chat(promptMessages, { maxTokens, temperature: 0.6 });
      const cleaned = raw.replace(/```json|```/g, '').trim();
      const start = cleaned.indexOf('{');
      const end = cleaned.lastIndexOf('}');
      if (start >= 0 && end > start) return JSON.parse(cleaned.slice(start, end + 1));
    } catch (e) {
      console.warn(`[AI] ${fnName} 调用失败，回退内置引擎:`, e.message);
    }
  }
  return builtinFn();
}

// ============ 内置演示引擎：岗位匹配简历 ============

const JD_KEYWORD_STOP = new Set(['的', '了', '和', '与', '及', '或', '等', '有', '会', '能', '可', '需', '负责', '参与', '优先', '要求', '熟悉', '了解', '具备', '良好', '一定', '相关', '工作', '经验', '能力', '职责', '岗位', '职位', '我们', '你将', '进行', '包括', '以及', '并且', '具备以下']);

function extractKeywords(text, limit = 24) {
  const tokens = String(text || '')
    .replace(/[，。；、：（）()【】\[\]“”"'《》\n\r\t]/g, ' ')
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2 && t.length <= 8)
    .filter((t) => !JD_KEYWORD_STOP.has(t) && !/^\d+$/.test(t));
  const freq = new Map();
  for (const t of tokens) freq.set(t, (freq.get(t) || 0) + 1);
  return [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([t]) => t);
}

function parseResumeSections(text) {
  const raw = String(text || '');
  const sectionPattern = /(教育经历|教育背景|实习经历|实习经验|项目经历|项目经验|工作经历|专业技能|技能清单|自我评价|个人总结|基本信息)/g;
  const markers = [];
  let m;
  while ((m = sectionPattern.exec(raw)) !== null) markers.push({ name: m[1], index: m.index });
  if (markers.length === 0) return { intro: raw.slice(0, 600) };
  const sections = {};
  markers.forEach((mk, i) => {
    const end = i + 1 < markers.length ? markers[i + 1].index : raw.length;
    sections[mk.name] = raw.slice(mk.index + mk.name.length, end).trim().slice(0, 1200);
  });
  return sections;
}

function buildCustomResume(baseResume, jd) {
  const sections = parseResumeSections(baseResume);
  const jdKeywords = extractKeywords(jd, 20);
  const resumeText = String(baseResume || '');
  const hit = jdKeywords.filter((k) => resumeText.includes(k));
  const score = Math.min(96, 45 + Math.round((hit.length / Math.max(jdKeywords.length, 1)) * 50));
  const target = (String(jd || '').match(/[^\n]{2,30}(?:工程师|开发|产品|运营|设计师|分析师|管培生|专员|经理)/) || ['目标岗位'])[0].slice(0, 30);

  const content = {
    head: {
      name: '【姓名】', contact: '【电话】｜【邮箱】｜【所在城市】',
      intent: `求职意向：${target.trim()}｜2027 届校招`,
    },
    education: sections['教育经历'] || sections['教育背景'] || '【学校】××大学 · 专业 ×× · 2023.09 – 2027.06 · 本科/硕士\n核心课程与成绩：GPA ×.× / 4.0，主修课程与岗位方向相关度较高',
    internship: sections['实习经历'] || sections['实习经验'] || '【实习】××公司 · ××岗位 · 2026.06 – 2026.09\n• 参与核心业务，产出可量化结果（示例：效率提升 / 数据增长）',
    projects: sections['项目经历'] || sections['项目经验'] || '【项目】××项目 · 负责人/核心成员\n• 围绕岗位能力要求设计并落地，沉淀方法论与可复用资产',
    skills: sections['专业技能'] || sections['技能清单'] || '【技能】与岗位匹配的技术栈/工具/方法论，按熟练度分级列出',
    selfEval: sections['自我评价'] || sections['个人总结'] || '【自我评价】结合目标岗位提炼 3 条核心优势，指向岗位关键能力',
  };

  const suggestions = [
    { section: '求职意向', tip: `已将求职意向对齐为「${target.trim()}」，建议逐份岗位微调，避免“海投感”。` },
    { section: '实习/项目经历', tip: '命中 JD 关键词：' + (hit.slice(0, 8).join('、') || '较少，建议补充与岗位强相关的经历与数据指标') + '。每条经历用「背景-动作-结果（含数字）」结构改写。' },
    { section: '专业技能', tip: '把与岗位最相关的 3–5 项技能提前，并附熟练程度与代表案例；弱相关技能后置或删除。' },
    { section: '版式', tip: '保持 1 页：微软雅黑正文 10.5pt、模块分界线、标题加粗，导出 Word 后检查无跨页断行。' },
  ];

  return { content, score, suggestions, jdKeywords, hitKeywords: hit };
}

// ============ 内置演示引擎：面试题预测 ============

const BEHAVIOR_QUESTIONS = [
  { q: '请做一个 1 分钟自我介绍，突出你与这个岗位的匹配点。', why: '考察表达结构、自我认知与岗位匹配度。', evidence: '用「背景-亮点-动机」三段式，数字量化亮点。', structure: '身份 → 1-2 个核心亮点 → 为什么选这个岗位/公司。' },
  { q: '讲一个你克服重大困难并取得结果的经历。', why: '考察抗压、问题解决与结果导向。', evidence: '选有冲突有数据的项目，交代背景、行动、结果。', structure: 'STAR：情境-任务-行动-结果。' },
  { q: '举一个你在团队中推动协作或解决分歧的例子。', why: '考察团队协作与影响力。', evidence: '说明分歧点、你的角色、达成共识的方法与最终效果。', structure: '场景 → 冲突 → 你的动作 → 结果与复盘。' },
  { q: '你最近 3 年最有成就感的一件事是什么？', why: '考察价值取向与自驱力。', evidence: '选与岗位能力相关、可量化的成就。', structure: '事情 → 你的贡献 → 量化结果 → 你的收获。' },
  { q: '如果任务期限很紧而资源不足，你会怎么安排优先级？', why: '考察目标管理与执行策略。', evidence: '给出明确的排序原则与取舍方法。', structure: '原则 → 具体做法 → 举例验证。' },
];

const HR_QUESTIONS = [
  { q: '为什么选择我们公司 / 为什么投这个岗位？', why: '考察求职动机与信息准备度。', evidence: '提前调研公司业务、近期动态与岗位要求，说 2-3 个具体理由。', structure: '公司层面 → 岗位层面 → 个人层面。' },
  { q: '你期望的薪资范围是多少？', why: '考察自我定位与沟通能力。', evidence: '结合市场行情、公司体量与自身竞争力给出区间。', structure: '参考区间 → 依据 → 表达弹性。' },
  { q: '你最大的优缺点是什么？', why: '考察自我认知的深度与真诚度。', evidence: '优点给证据，缺点给改进动作，避免“太追求完美”式回答。', structure: '优点+例子 → 缺点+改进 → 关联岗位。' },
  { q: '未来 3-5 年的职业规划是什么？', why: '考察稳定性与发展诉求。', evidence: '规划要与岗位发展路径吻合，体现成长性。', structure: '短期(1年) → 中期(3年) → 长期愿景。' },
];

const CATEGORY_PROFESSIONAL = {
  技术: [
    { q: '请讲一个你最有技术含量的项目，你负责哪部分、遇到什么难点、如何解决？', why: '考察技术深度、架构思维与工程实践。', evidence: '选择能体现数据规模或性能瓶颈的项目，讲清方案对比。', structure: '背景-方案选型-实现-量化收益。' },
    { q: '如何保证系统在高并发下的稳定性？', why: '考察工程化与性能意识。', evidence: '从限流、缓存、异步、降级、监控多角度展开。', structure: '场景 → 手段 → 取舍 → 验证。' },
    { q: '你如何排查一个线上疑难问题？', why: '考察问题定位能力。', evidence: '给出完整的排查链路：现象-假设-验证-结论。', structure: '复现 → 缩小范围 → 定位根因 → 修复与回归。' },
    { q: '你最近学习的编程语言或框架是什么？怎么学的？', why: '考察学习能力与技术热情。', evidence: '给出具体的学习路径与产出（笔记/项目/贡献）。', structure: '动机 → 方法 → 成果。' },
    { q: '代码评审中你与同事意见不一致时怎么办？', why: '考察沟通与工程协作。', evidence: '强调用数据与实验说话，尊重方案但坚持正确性。', structure: '分歧 → 依据 → 解决 → 关系维护。' },
  ],
  产品: [
    { q: '如何评估一个产品需求的价值？', why: '考察需求判断与优先级思维。', evidence: '从用户价值、商业价值、成本与风险四维评估。', structure: '用户 → 商业 → 成本 → 结论。' },
    { q: '讲一个你从 0 到 1 或推动优化的产品项目。', why: '考察产品闭环能力。', evidence: '说明洞察、方案、落地与数据结果。', structure: '问题定义 → 方案 → 落地 → 数据验证。' },
    { q: '如果数据表明你上线的功能效果不好，你会怎么做？', why: '考察数据驱动与复盘能力。', evidence: '先拆解数据分层定位问题，再制定迭代假设。', structure: '归因 → 假设 → 迭代 → 复盘。' },
    { q: '你如何做竞品分析？', why: '考察研究框架与提炼能力。', evidence: '给出竞品选择标准、分析维度与结论输出方式。', structure: '选品 → 维度 → 洞察 → 行动。' },
    { q: '你最喜欢的 App 是什么？为什么？', why: '考察产品sense与思考深度。', evidence: '选择有特点的产品，从需求、交互、商业角度分析。', structure: '选品 → 亮点拆解 → 可借鉴处。' },
  ],
  运营: [
    { q: '如何做一次活动的用户增长？请给出完整方案。', why: '考察活动策划与增长思维。', evidence: '覆盖目标拆解、渠道、玩法、预算与复盘指标。', structure: '目标 → 策略 → 执行 → 数据复盘。' },
    { q: '你如何衡量一次运营动作的效果？', why: '考察数据指标意识。', evidence: '区分核心指标与过程指标，说明归因方法。', structure: '指标体系 → 归因 → 优化。' },
    { q: '讲一个你运营或推广的真实案例。', why: '考察实操与结果。', evidence: '量化用户数、转化率、留存等关键数据。', structure: '背景 → 动作 → 结果 → 经验沉淀。' },
    { q: '如果一个渠道的转化率下降了，你会如何排查？', why: '考察数据归因与问题定位。', evidence: '按渠道-环节-用户分层定位。', structure: '假设 → 数据验证 → 定位 → 动作。' },
    { q: '你如何理解私域运营 / 用户分层？', why: '考察运营方法论。', evidence: '结合具体场景给出分层与触达策略。', structure: '定义 → 方法 → 案例。' },
  ],
  市场: [
    { q: '如何为一款新产品制定上市传播策略？', why: '考察市场策略全局观。', evidence: '覆盖定位、目标人群、渠道组合与节奏。', structure: '洞察 → 策略 → 渠道 → 节奏 → 衡量。' },
    { q: '讲一个你策划或参与的营销案例。', why: '考察策划与执行能力。', evidence: '说明创意、执行与传播数据。', structure: '背景 → 创意 → 执行 → 效果。' },
    { q: '如何评估一次投放/传播的 ROI？', why: '考察商业与数据思维。', evidence: '给出成本、转化与归因口径。', structure: '成本 → 转化 → 归因 → 优化。' },
    { q: '你关注哪些营销新趋势？', why: '考察行业敏感度。', evidence: '结合 1-2 个趋势说清影响与适用场景。', structure: '趋势 → 案例 → 判断。' },
    { q: '如何与 KOL/媒体谈判合作？', why: '考察商务与资源整合能力。', evidence: '讲清目标、预算、共创价值与谈判要点。', structure: '目标 → 价值 → 谈判 → 落地。' },
  ],
  职能: [
    { q: '如何高效处理多任务并行？请举例。', why: '考察计划与执行能力。', evidence: '给出排序方法与实际例子。', structure: '方法 → 例子 → 结果。' },
    { q: '你如何与跨部门同事协作？', why: '考察沟通与协调能力。', evidence: '说明推动机制与冲突处理。', structure: '场景 → 方法 → 结果。' },
    { q: '如何保证工作数据/信息的准确性？', why: '考察严谨性与流程意识。', evidence: '给出核验机制与工具。', structure: '风险 → 机制 → 案例。' },
    { q: '讲一次你主动改进工作流程的经历。', why: '考察主动性。', evidence: '量化改进前后的效率差异。', structure: '现状 → 改进 → 结果。' },
    { q: '你如何看待加班与工作生活的平衡？', why: '考察价值观与稳定性。', evidence: '表达投入度同时体现理性与可持续。', structure: '态度 → 场景 → 平衡方法。' },
  ],
};

const COMPANY_QUESTIONS = [
  { q: '你对我们公司当前最重要的业务或产品怎么看？', why: '考察信息调研与商业理解。', evidence: '提前调研公司官网、新闻与财报，给出有观点的分析。', structure: '事实 → 判断 → 依据。' },
  { q: '如果你入职后前 3 个月的目标是什么？', why: '考察入职准备与落地思维。', evidence: '分学习期、融入期、产出期设计目标。', structure: '学习 → 融入 → 产出。' },
  { q: '我们为什么要录用你，而不是其他人？', why: '考察自我认知与差异化表达。', evidence: '结合 JD 给出 3 条不可替代的理由。', structure: '匹配 → 差异 → 承诺。' },
];

function buildQuestionBank(jd, category) {
  const cat = category || guessCategory(jd);
  const professional = CATEGORY_PROFESSIONAL[cat] || CATEGORY_PROFESSIONAL['职能'];
  const jdKeywords = extractKeywords(jd, 6);
  const companyTail = jdKeywords.length
    ? `（参考岗位关键词：${jdKeywords.join('、')}）`
    : '';
  const tail = (o) => ({ ...o, q: o.q + companyTail, category: 'professional' });
  return {
    behavior: BEHAVIOR_QUESTIONS.map((o, i) => ({ ...o, id: `b${i}`, category: 'behavior' })),
    professional: professional.map((o, i) => ({ ...tail(o), id: `p${i}`, category: 'professional' })),
    hr: HR_QUESTIONS.map((o, i) => ({ ...o, id: `h${i}`, category: 'hr' })),
    company: COMPANY_QUESTIONS.map((o, i) => ({ ...o, id: `c${i}`, category: 'company' })),
  };
}

function guessCategory(jd) {
  const t = String(jd || '');
  if (/算法|后端|前端|测试|运维|客户端|大数据|AI|机器学习|开发|工程/.test(t)) return '技术';
  if (/产品|需求|PM/.test(t)) return '产品';
  if (/运营|增长|内容|用户|活动/.test(t)) return '运营';
  if (/市场|营销|品牌|公关|投放/.test(t)) return '市场';
  return '职能';
}

// ============ 内置演示引擎：答案评分 ============

function scoreAnswer(question, answer) {
  const a = String(answer || '').trim();
  const len = a.length;
  let score = 0;
  const missed = [];
  if (len < 30) { score += 15; missed.push('回答过短，缺乏有效信息'); }
  else if (len < 80) { score += 35; missed.push('内容偏简略，建议补充具体案例'); }
  else { score += 50; }
  if (/\d|数字|%|人|个|次|万|增长|提升|降低/.test(a)) score += 25; else missed.push('缺少量化数据支撑');
  if (/我|负责|主导|推动|完成/.test(a)) score += 15; else missed.push('缺少个人角色与行动（多用“我”主语）');
  if (/因为|所以|首先|然后|最后|通过|从而|结果/.test(a)) score += 10; else missed.push('缺少逻辑连接词，结构化不足');
  score = Math.min(100, score);
  const tips = [
    '用「情境-任务-行动-结果」结构重述，开头 10 秒给出结论。',
    '每个要点尽量带一个可验证的数字（规模、时长、效率提升）。',
    '结尾主动关联目标岗位的能力要求，体现匹配度。',
  ];
  return { score, missed, tips };
}

// ============ 内置演示引擎：AI 教练追问 ============

function coachRoundQuestions(card) {
  const base = [
    { q: '这件事里你的具体角色和动作是什么？请用「我」开头逐条说明。', why: '区分个人贡献与团队成果，便于沉淀真实的个人能力点。' },
    { q: '过程中的关键难点是什么？你是怎么解决的？', why: '挖掘问题解决与抗压能力，这是面试官最看重的部分。' },
    { q: '最终取得了什么可量化的结果？数据或反馈是什么？', why: '用数据锚定经历价值，形成可写入简历的量化结论。' },
  ];
  return base;
}

// ============ 内置演示引擎：面试复盘 ============

function analyzeTranscript(transcript) {
  const t = String(transcript || '');
  const qaPairs = t.split(/\n+/).filter(Boolean).slice(0, 30);
  const weak = [];
  const good = [];
  if (/(没|不知道|不太会|没准备|不熟悉)/.test(t)) weak.push('部分问题暴露知识盲区，需系统补课');
  if (!/\d|%|数字/.test(t)) weak.push('回答普遍缺少量化数据，说服力不足');
  if (qaPairs.length < 4) weak.push('对话内容偏少，复盘样本不足');
  if (!/(STAR|背景|结果)/.test(t)) weak.push('结构化表达不明显，建议强化 STAR 框架');
  if (/(谢谢你|感谢|请问|我的理解是)/.test(t)) good.push('表达礼貌、有互动意识');
  if (/(首先|然后|最后|一方面|另一方面)/.test(t)) good.push('具备一定的条理性');
  if (!weak.length) good.push('整体表达完整，继续保持');
  const summary = `共解析 ${qaPairs.length} 轮问答。${good.length ? '亮点：' + good.join('；') : ''}${weak.length ? '薄弱项：' + weak.join('；') : ''}。建议针对薄弱项做专项练习，并在下次面试前准备好 5 个核心故事（每个含量化结果）。`;
  return { summary, good, weak, qaCount: qaPairs.length };
}

// ============ 内置演示引擎：知识库问答 ============

function answerFromKnowledgeBuiltin(question, docs) {
  if (!docs.length) return '知识库中还没有可参考的内容。请先录入面经、公司资料或笔记，再向我提问。';
  const q = String(question || '');
  const scored = docs.map((d) => {
    const content = String(d.content || '');
    const kw = extractKeywords(q, 12);
    const hit = kw.filter((k) => content.includes(k)).length;
    return { doc: d, hit, rate: kw.length ? hit / kw.length : 0 };
  }).sort((a, b) => b.hit - a.hit);
  const top = scored.slice(0, 3).filter((s) => s.hit > 0);
  const refs = (top.length ? top : scored.slice(0, 2)).map((s) => `《${s.doc.title}》`);
  let body;
  if (top.length) {
    body = top.map((s) => {
      const c = String(s.doc.content || '');
      const kw = extractKeywords(q, 6);
      const idx = kw.map((k) => c.indexOf(k)).filter((i) => i >= 0).sort((a, b) => a - b)[0];
      const seg = idx != null ? c.slice(Math.max(0, idx - 60), idx + 220) : c.slice(0, 220);
      return `· ${s.doc.title}：${seg.replace(/\s+/g, ' ').trim()}…`;
    }).join('\n');
  } else {
    body = '未检索到与问题直接相关的内容，以下为知识库中可能相关的资料：\n' + refs.join('、');
  }
  return `根据知识库检索结果（${refs.join('、')}）：\n${body}\n\n如需更精确的回答，建议补充与该问题相关的笔记或面经。`;
}

// ============ 内置演示引擎：简历拆解 ============

function parseResumeToCards(resumeText) {
  const sections = parseResumeSections(resumeText);
  const cards = [];
  const pushCard = (type, title, org, content, tags) => {
    if (!content || content.length < 4) return;
    cards.push({
      card_type: type, title, org, period: '',
      content: String(content).split(/\n+/).map((s) => s.replace(/^[•·\-]\s*/, '').trim()).filter(Boolean).slice(0, 6),
      tags: tags.filter(Boolean).slice(0, 5),
      source_resume: '初版简历自动拆解',
    });
  };
  pushCard('education', '教育经历', '院校', sections['教育经历'] || sections['教育背景'], ['学历', 'GPA']);
  pushCard('internship', '实习经历', '实习单位', sections['实习经历'] || sections['实习经验'], ['实习', '岗位']);
  pushCard('project', '项目经历', '项目名称', sections['项目经历'] || sections['项目经验'], ['项目']);
  pushCard('skill', '专业技能', '技能', sections['专业技能'] || sections['技能清单'], ['技能']);
  if (!cards.length) {
    // 无明确分节时，按段落粗拆
    const paras = String(resumeText || '').split(/\n+/).filter((s) => s.trim().length > 10).slice(0, 4);
    paras.forEach((p, i) => cards.push({ card_type: 'project', title: `经历片段 ${i + 1}`, org: '', period: '', content: [p.trim().slice(0, 200)], tags: ['待整理'], source_resume: '初版简历自动拆解' }));
  }
  return cards;
}

// ============ 对外接口 ============

/** 生成定制简历：返回 { content, score, suggestions, mode } */
async function generateCustomResume(baseResume, jd) {
  if (isAiEnabled()) {
    try {
      const prompt = [
        { role: 'system', content: '你是一名资深校招简历顾问。请根据用户提供的通用简历与目标岗位 JD，生成一份 1 页定制版简历（保留原简历全部事实，不虚构信息，只做重组、去重、与 JD 关键词对齐），并给出岗位匹配度评分(0-100)与逐段优化建议。严格输出 JSON：{"content":{"head":{...},"education":"...","internship":"...","projects":"...","skills":"...","selfEval":"..."},"score":88,"suggestions":[{"section":"...","tip":"..."}]}' },
        { role: 'user', content: `【通用简历】\n${String(baseResume).slice(0, 6000)}\n\n【目标岗位 JD】\n${String(jd).slice(0, 4000)}` },
      ];
      const raw = await chat(prompt, { maxTokens: 1800, temperature: 0.5 });
      const cleaned = raw.replace(/```json|```/g, '').trim();
      const start = cleaned.indexOf('{');
      const end = cleaned.lastIndexOf('}');
      const data = JSON.parse(cleaned.slice(start, end + 1));
      if (data.content && typeof data.score === 'number') {
        return { ...data, suggestions: Array.isArray(data.suggestions) ? data.suggestions : [], mode: 'ai' };
      }
    } catch (e) {
      console.warn('[AI] generateCustomResume 回退内置:', e.message);
    }
  }
  const r = buildCustomResume(baseResume, jd);
  return { content: r.content, score: r.score, suggestions: r.suggestions, mode: 'builtin' };
}

/** 预测面试题：4 模块题库 */
async function predictQuestions(jd, category) {
  if (isAiEnabled()) {
    try {
      const prompt = [
        { role: 'system', content: '你是校招面试教练。基于 JD 生成 4 模块面试题库：行为面5题、专业面5题、HR面4题、公司专属题3题。每题含 q(问题)、why(为什么问)、evidence(回答证据/准备素材建议)、structure(回答结构)。严格输出 JSON：{"behavior":[...],"professional":[...],"hr":[...],"company":[...]}' },
        { role: 'user', content: `岗位 JD：\n${String(jd).slice(0, 4000)}` },
      ];
      const raw = await chat(prompt, { maxTokens: 2200, temperature: 0.6 });
      const cleaned = raw.replace(/```json|```/g, '').trim();
      const start = cleaned.indexOf('{');
      const end = cleaned.lastIndexOf('}');
      const data = JSON.parse(cleaned.slice(start, end + 1));
      if (data.behavior && data.professional) return data;
    } catch (e) {
      console.warn('[AI] predictQuestions 回退内置:', e.message);
    }
  }
  return buildQuestionBank(jd, category);
}

/** 模拟面试单题评分 */
async function scoreInterviewAnswer(question, answer, jd) {
  if (isAiEnabled()) {
    try {
      const prompt = [
        { role: 'system', content: '你是严格的校招面试官。根据面试题、岗位 JD 与候选人回答，输出 JSON：{"score":0-100,"feedback":"点评","missed":["踩分点缺失1","..."],"tips":["优化建议1","..."]}' },
        { role: 'user', content: `面试题：${question}\n岗位JD：${String(jd || '').slice(0, 2000)}\n候选人回答：${String(answer).slice(0, 3000)}` },
      ];
      const raw = await chat(prompt, { maxTokens: 800, temperature: 0.4 });
      const cleaned = raw.replace(/```json|```/g, '').trim();
      const start = cleaned.indexOf('{');
      const end = cleaned.lastIndexOf('}');
      const data = JSON.parse(cleaned.slice(start, end + 1));
      if (typeof data.score === 'number') return { ...data, score: Math.max(0, Math.min(100, data.score)) };
    } catch (e) {
      console.warn('[AI] scoreInterviewAnswer 回退内置:', e.message);
    }
  }
  return scoreAnswer(question, answer);
}

/** AI 教练一轮追问（3 个问题） */
async function coachRound(card, history) {
  if (isAiEnabled()) {
    try {
      const histText = history.map((h) => `Q: ${h.q}\nA: ${h.a}`).join('\n---\n');
      const prompt = [
        { role: 'system', content: '你是校招 AI 教练，帮求职者深挖经历资产。基于经历卡片与对话历史，追问 3 个问题（每轮不同侧重：角色贡献 → 难点解决 → 量化结果），问题要具体、直指可沉淀到简历的素材。严格输出 JSON：{"questions":[{"q":"...","why":"..."}]}' },
        { role: 'user', content: `经历卡片：\n类型: ${card.card_type}\n标题: ${card.title}\n内容: ${JSON.stringify(card.content)}\n\n对话历史：\n${histText || '（无）'}` },
      ];
      const raw = await chat(prompt, { maxTokens: 800, temperature: 0.6 });
      const cleaned = raw.replace(/```json|```/g, '').trim();
      const start = cleaned.indexOf('{');
      const end = cleaned.lastIndexOf('}');
      const data = JSON.parse(cleaned.slice(start, end + 1));
      if (Array.isArray(data.questions) && data.questions.length) return data.questions.slice(0, 3);
    } catch (e) {
      console.warn('[AI] coachRound 回退内置:', e.message);
    }
  }
  return coachRoundQuestions(card);
}

/** 面试复盘解析（录音转文字/手动文本） */
async function analyzeInterview(transcript) {
  if (isAiEnabled()) {
    try {
      const prompt = [
        { role: 'system', content: '你是校招复盘教练。根据面试对话文本，输出 JSON：{"summary":"整体评价","good":["亮点"],"weak":["薄弱项"],"qaCount":N}' },
        { role: 'user', content: `面试对话：\n${String(transcript).slice(0, 6000)}` },
      ];
      const raw = await chat(prompt, { maxTokens: 900, temperature: 0.5 });
      const cleaned = raw.replace(/```json|```/g, '').trim();
      const start = cleaned.indexOf('{');
      const end = cleaned.lastIndexOf('}');
      const data = JSON.parse(cleaned.slice(start, end + 1));
      if (data.summary) return data;
    } catch (e) {
      console.warn('[AI] analyzeInterview 回退内置:', e.message);
    }
  }
  return analyzeTranscript(transcript);
}

/** 知识库问答（检索增强） */
async function askKnowledge(question, docs) {
  if (isAiEnabled()) {
    try {
      const ctx = docs.slice(0, 8).map((d, i) => `【资料${i + 1}《${d.title}》】\n${String(d.content).slice(0, 1500)}`).join('\n\n');
      const prompt = [
        { role: 'system', content: '你是求职知识库助手。仅依据下方资料回答用户问题，若资料不足请明确说明；回答条理清晰、可引用资料编号。' },
        { role: 'user', content: `资料：\n${ctx}\n\n问题：${question}` },
      ];
      return await chat(prompt, { maxTokens: 1000, temperature: 0.4 });
    } catch (e) {
      console.warn('[AI] askKnowledge 回退内置:', e.message);
    }
  }
  return answerFromKnowledgeBuiltin(question, docs);
}

/** 简历文本 → 结构化经历卡片 */
async function extractExperiences(resumeText) {
  if (isAiEnabled()) {
    try {
      const prompt = [
        { role: 'system', content: '你是简历解析器。把简历文本拆解为结构化经历卡片，输出 JSON：{"cards":[{"card_type":"education|internship|project|skill","title":"...","org":"...","period":"...","content":["要点1","..."],"tags":["标签"]}]}' },
        { role: 'user', content: String(resumeText).slice(0, 6000) },
      ];
      const raw = await chat(prompt, { maxTokens: 1500, temperature: 0.3 });
      const cleaned = raw.replace(/```json|```/g, '').trim();
      const start = cleaned.indexOf('{');
      const end = cleaned.lastIndexOf('}');
      const data = JSON.parse(cleaned.slice(start, end + 1));
      if (Array.isArray(data.cards) && data.cards.length) return data.cards;
    } catch (e) {
      console.warn('[AI] extractExperiences 回退内置:', e.message);
    }
  }
  return parseResumeToCards(resumeText);
}

/** 图片 OCR（视觉理解）。未配置视觉模型时返回 null。 */
async function ocrImage(imageDataUrl) {
  if (!isAiEnabled()) return null;
  try {
    const resp = await fetch(`${BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${API_KEY}` },
      body: JSON.stringify({
        model: VISION_MODEL,
        messages: [
          { role: 'user', content: [{ type: 'text', text: '请完整识别并转写这张图片中的文字，保持原有结构。' }, { type: 'image_url', image_url: { url: imageDataUrl } }] },
        ],
        max_tokens: 1500,
      }),
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    return data.choices?.[0]?.message?.content ?? null;
  } catch {
    return null;
  }
}

module.exports = {
  isAiEnabled,
  chat,
  generateCustomResume,
  predictQuestions,
  scoreInterviewAnswer,
  coachRound,
  analyzeInterview,
  askKnowledge,
  extractExperiences,
  ocrImage,
  guessCategory,
  extractKeywords,
};
