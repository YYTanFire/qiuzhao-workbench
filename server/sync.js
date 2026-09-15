'use strict';
/**
 * 每日岗位同步（数据源可插拔）
 *
 * 主数据源（真实公开）：HU-eun/campus-recruitment 校招信息汇总平台
 *   - 公开 GitHub 仓库，7200+ 条 2027 届校招/实习岗位，每日自动更新
 *   - 仅使用公开招聘信息（公司名、岗位、截止时间、官方公告链接等），字段可追溯
 * 离线回退：网络不可用时自动切换内置演示池（虚构企业），保证产品可演示。
 */
const { all, run, tx, db } = require('./db');
const { guessCategory } = require('./ai/service');

const REAL_SOURCE_URL = 'https://raw.githubusercontent.com/HU-eun/campus-recruitment/main/data/jobs.json';
const REAL_SOURCE_NAME = '校招信息汇总平台（公开 GitHub）';
const DEMO_SOURCE_NAME = '内置演示数据源（离线回退）';

// ==================== 数据标准化 ====================

const S = (v) => (v == null ? '' : String(v));
const A = (v) => (Array.isArray(v) ? v : v == null || v === '' ? [] : [v]);
const pad = (n) => String(n).padStart(2, '0');

const BATCH_MAP = {
  '秋招': '秋招批',
  '秋招提前批': '提前批',
  '春招': '春招批',
  '春招补录': '补录批',
};

/** 批次字段可能是「春招,秋招提前批」这类多值，拆分后取第一个校招批次 */
function normalizeBatch(raw) {
  const parts = String(raw).split(/[,，、/]/).map((s) => s.trim()).filter(Boolean);
  for (const p of parts) {
    if (BATCH_MAP[p]) return BATCH_MAP[p];
    if (p && !/实习/.test(p)) return p;
  }
  return '';
}

/** 真实数据 → 标准行结构；非 2027 届校招、指南类记录返回 null */
function normalizeReal(r) {
  const company = S(r['公司名称']).trim();
  if (!company || company === '筛选前必看-点这里' || /必看|说明|目录/.test(company)) return null;
  const targets = A(r['招聘对象']).map(S);
  if (!targets.some((t) => t.includes('2027届'))) return null;

  const batchRaw = S(r['批次']).trim();
  const batch = normalizeBatch(batchRaw);
  // 只保留校招批次（秋招/提前批/春招/补录），排除纯实习、日常实习
  if (!batch || /实习/.test(batchRaw)) return null;

  // 截止时间：能解析为日期则存日期，否则保留原文（如「尽快投递」）
  let deadline = S(r['截止时间']).trim();
  let deadlineText = deadline;
  const m = deadline.match(/(\d{4})[/\-.](\d{1,2})[/\-.](\d{1,2})/);
  if (m) {
    deadline = `${m[1]}-${pad(m[2])}-${pad(m[3])}`;
    deadlineText = '';
  } else {
    deadline = '';
  }

  const locations = A(r['工作地点']).map(S).filter(Boolean);
  const locText = S(r['工作地点文本']).trim();
  const hasTest = A(r['是否需要笔试']).map(S).some((t) => /需要笔试|含免笔试|笔试/.test(t)) ? 1 : 0;
  const position = S(r['招聘岗位']).trim().replace(/\s+/g, ' ').slice(0, 200);

  return {
    company,
    position: position || '校招岗位（详见官方公告）',
    company_type: A(r['企业性质']).map(S).filter(Boolean).join(' / '),
    industry: A(r['行业大类']).map(S).filter(Boolean).join(' / '),
    job_category: guessCategory(position),
    location: locText || locations.join(' / ') || '全国多地',
    education_required: '',
    salary_min: null,
    salary_max: null,
    deadline,
    deadline_text: deadlineText,
    has_written_test: hasTest,
    session_year: '2027',
    batch,
    major_requirement: '',
    source: REAL_SOURCE_NAME,
    official_url: S(r['官方公告']).trim(),
    apply_url: S(r['投递方式']).trim(),
    is_demo: 0,
  };
}

/** 拉取并标准化真实公开岗位（带一次重试） */
async function fetchRealJobs() {
  let lastErr;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const resp = await fetch(REAL_SOURCE_URL, {
        headers: { 'User-Agent': 'qiuzhao-workbench/2.0' },
        signal: AbortSignal.timeout(60000),
      });
      if (!resp.ok) throw new Error(`数据源响应异常 HTTP ${resp.status}`);
      const data = await resp.json();
      if (!Array.isArray(data)) throw new Error('数据源格式异常（非数组）');
      return data.map(normalizeReal).filter(Boolean);
    } catch (e) {
      lastErr = e;
      if (attempt === 1) await new Promise((r) => setTimeout(r, 1500));
    }
  }
  throw lastErr;
}

// ==================== 内置演示池（离线回退） ====================

const POOL = [
  ['星舟网络', 'Java 后端开发工程师', '互联网大厂', '互联网', '技术', '北京', '硕士', 22, 35, 1, '2027', '秋招批', '计算机/软件工程'],
  ['云杉科技', '前端开发工程师', '互联网大厂', '互联网', '技术', '上海', '本科', 20, 30, 1, '2027', '秋招批', '计算机相关专业'],
  ['北辰智能', '算法工程师（AI）', '科技独角兽', '人工智能', '技术', '北京', '硕士', 30, 45, 1, '2027', '提前批', '计算机/AI/数学'],
  ['澜庭数字', '产品经理', '互联网大厂', '互联网', '产品', '杭州', '本科', 18, 28, 0, '2027', '秋招批', '不限'],
  ['恒宇通信', '通信研发工程师', '央企国企', '通信', '技术', '深圳', '硕士', 18, 26, 1, '2027', '秋招批', '通信/电子'],
  ['远见咨询', '咨询顾问（管培生）', '外企', '专业服务', '职能', '上海', '硕士', 15, 22, 0, '2027', '提前批', '不限，商科优先'],
  ['绿能新能源', '电池研发工程师', '新能源企业', '新能源', '技术', '常州', '硕士', 20, 32, 1, '2027', '秋招批', '材料/化学/机械'],
  ['澄明金融科技', '数据分析师', '金融机构', '金融', '职能', '上海', '硕士', 18, 27, 1, '2027', '秋招批', '统计/数学/计算机'],
  ['经纬智造', '智能制造管培生', '制造业龙头', '高端制造', '职能', '武汉', '本科', 12, 18, 0, '2027', '秋招批', '机械/自动化'],
  ['启航教育', '用户运营专员', '教育企业', '教育', '运营', '广州', '本科', 10, 16, 0, '2027', '秋招批', '不限'],
  ['蓝湾生物', '医药市场助理', '生物医药', '生物医药', '市场', '南京', '本科', 11, 16, 0, '2027', '秋招批', '医药/市场相关'],
  ['盛达消费', '品牌营销管培生', '快消企业', '快消', '市场', '上海', '本科', 12, 18, 0, '2027', '提前批', '不限'],
  ['磐石物流', '供应链运营岗', '物流企业', '物流', '运营', '成都', '本科', 9, 14, 0, '2027', '秋招批', '物流/管理'],
  ['天枢云', '云原生开发工程师', '科技独角兽', '云计算', '技术', '深圳', '硕士', 24, 38, 1, '2027', '秋招批', '计算机'],
  ['东望证券', '金融科技岗', '金融机构', '金融', '技术', '上海', '硕士', 20, 30, 1, '2027', '秋招批', '金融工程/计算机'],
  ['青藤游戏', '游戏客户端开发', '互联网企业', '游戏', '技术', '广州', '本科', 20, 32, 1, '2027', '提前批', '计算机'],
  ['智行汽车', '自动驾驶测试工程师', '新能源车企', '汽车', '技术', '北京', '本科', 18, 28, 1, '2027', '秋招批', '车辆/计算机/控制'],
  ['禾风传媒', '内容运营（新媒体）', '传媒企业', '传媒', '运营', '北京', '本科', 10, 16, 0, '2027', '秋招批', '不限'],
  ['安澜保险', '精算岗（校招）', '金融机构', '保险', '职能', '上海', '硕士', 16, 24, 1, '2027', '秋招批', '精算/数学/统计'],
  ['瑞景地产', '人力资源管培生', '地产企业', '地产', '职能', '北京', '本科', 11, 16, 0, '2027', '秋招批', '人力/管理'],
  ['澜图设计', 'UI/UX 设计师', '互联网企业', '互联网', '市场', '杭州', '本科', 13, 20, 0, '2027', '提前批', '设计相关'],
  ['沐光新能源', '光伏系统工程师', '新能源企业', '新能源', '技术', '西安', '本科', 13, 20, 1, '2027', '秋招批', '电气/能源/物理'],
  ['飞驰出行', '策略产品经理', '互联网企业', '出行', '产品', '北京', '本科', 17, 26, 0, '2027', '秋招批', '不限'],
  ['橡树资本', '投研助理（量化方向）', '金融机构', '金融', '职能', '上海', '硕士', 22, 35, 1, '2027', '提前批', '金融/数学/计算机'],
  ['微澜电商', '电商运营管培生', '互联网企业', '电商', '运营', '杭州', '本科', 11, 17, 0, '2027', '秋招批', '不限'],
  ['极光软件', '测试开发工程师', '软件企业', '软件', '技术', '成都', '本科', 14, 22, 1, '2027', '秋招批', '计算机'],
];

function daysFromNow(n) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function buildDemoRows() {
  const offsets = [2, 3, 4, 6, 8, 10, 13, 16, 20, 25];
  return POOL.map((p, i) => {
    const [company, position, company_type, industry, job_category, location, education_required, salary_min, salary_max, hasWritten, session_year, batch, major_requirement] = p;
    return {
      company, position, company_type, industry, job_category, location, education_required,
      salary_min, salary_max, has_written_test: hasWritten, session_year, batch, major_requirement,
      deadline: daysFromNow(offsets[i % offsets.length]),
      deadline_text: '', official_url: '', apply_url: '', is_demo: 1, source: DEMO_SOURCE_NAME,
    };
  });
}

// ==================== 同步主流程 ====================

function upsertJob(r, now) {
  const exist = db.prepare('SELECT id FROM jobs WHERE company = ? AND position = ? AND batch = ? AND session_year = ?')
    .get(r.company, r.position, r.batch, r.session_year);
  if (exist) {
    db.prepare(`UPDATE jobs SET company_type=?, industry=?, job_category=?, location=?, education_required=?, salary_min=?, salary_max=?, deadline=?, deadline_text=?, has_written_test=?, major_requirement=?, source=?, official_url=?, apply_url=?, is_demo=?, synced_at=? WHERE id=?`)
      .run(r.company_type || '', r.industry || '', r.job_category || '', r.location || '', r.education_required || '', r.salary_min, r.salary_max, r.deadline || '', r.deadline_text || '', r.has_written_test || 0, r.major_requirement || '', r.source || '', r.official_url || '', r.apply_url || '', r.is_demo || 0, now, exist.id);
    return 'updated';
  }
  db.prepare(`INSERT INTO jobs (company, position, company_type, industry, job_category, location, education_required, salary_min, salary_max, deadline, deadline_text, has_written_test, session_year, batch, major_requirement, source, official_url, apply_url, is_demo, synced_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(r.company, r.position, r.company_type || '', r.industry || '', r.job_category || '', r.location || '', r.education_required || '', r.salary_min, r.salary_max, r.deadline || '', r.deadline_text || '', r.has_written_test || 0, r.session_year || '2027', r.batch || '', r.major_requirement || '', r.source || '', r.official_url || '', r.apply_url || '', r.is_demo || 0, now);
  return 'added';
}

/** 执行一次同步 */
async function runSyncOnce() {
  const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
  let rows, real = true, usedFallback = false;
  try {
    rows = await fetchRealJobs();
    if (!rows.length) throw new Error('真实数据源返回 0 条');
  } catch (e) {
    console.warn(`[同步] 真实数据源拉取失败，切换内置演示池: ${e.message}`);
    rows = buildDemoRows();
    real = false;
    usedFallback = true;
  }

  let added = 0, updated = 0;
  tx(() => {
    if (real) {
      // 真实数据就绪：清掉旧的演示岗位及其投递，避免虚构数据混入
      const demoIds = all('SELECT id FROM jobs WHERE is_demo = 1');
      for (const d of demoIds) run('DELETE FROM applications WHERE job_id = ?', [d.id]);
      run('DELETE FROM jobs WHERE is_demo = 1');
    } else {
      // 离线回退：仅当库中没有任何真实岗位时才补演示数据（避免与真实数据混用）
      const realCount = all('SELECT COUNT(*) AS c FROM jobs WHERE is_demo = 0')[0].c;
      if (realCount > 0) {
        rows = [];
      }
    }
    for (const r of rows) {
      const st = upsertJob(r, now);
      if (st === 'added') added++;
      else updated++;
    }
  });

  const total = all('SELECT COUNT(*) AS c FROM jobs')[0].c;
  return { added, updated, total, synced_at: now, source: real ? REAL_SOURCE_NAME : DEMO_SOURCE_NAME, fallback: usedFallback };
}

// 独立脚本入口：node server/sync.js
if (require.main === module) {
  runSyncOnce().then((r) => {
    console.log(`[同步完成] 来源=${r.source} 新增 ${r.added}，刷新 ${r.updated}，当前共 ${r.total} 条岗位，时间 ${r.synced_at}`);
  }).catch((e) => {
    console.error('[同步失败]', e);
    process.exit(1);
  });
}

module.exports = { runSyncOnce, REAL_SOURCE_NAME, DEMO_SOURCE_NAME };
