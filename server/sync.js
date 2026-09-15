'use strict';
/**
 * 每日岗位同步
 * - 默认使用内置演示数据源（虚构企业、公开演示用），每日凌晨自动刷新截止日期与状态
 * - 数据源可配置：接入真实公开招聘信息时，实现 fetchSources() 返回同样的行结构即可
 */
const { all, run, tx, db } = require('./db');

// 演示数据池：虚构企业名，避免第三方品牌与知识产权问题
const POOL = [
  ['星舟网络', 'Java 后端开发工程师', '互联网大厂', '互联网', '技术', '北京', '硕士', 22, 35, 1, '2027', '秋招批', '计算机/软件工程', '校招信息汇总表'],
  ['云杉科技', '前端开发工程师', '互联网大厂', '互联网', '技术', '上海', '本科', 20, 30, 1, '2027', '秋招批', '计算机相关专业', '企业官网招聘页'],
  ['北辰智能', '算法工程师（AI）', '科技独角兽', '人工智能', '技术', '北京', '硕士', 30, 45, 1, '2027', '提前批', '计算机/AI/数学', '校招信息汇总表'],
  ['澜庭数字', '产品经理', '互联网大厂', '互联网', '产品', '杭州', '本科', 18, 28, 0, '2027', '秋招批', '不限', '企业官网招聘页'],
  ['恒宇通信', '通信研发工程师', '央企国企', '通信', '技术', '深圳', '硕士', 18, 26, 1, '2027', '秋招批', '通信/电子', '校招信息汇总表'],
  ['远见咨询', '咨询顾问（管培生）', '外企', '专业服务', '职能', '上海', '硕士', 15, 22, 0, '2027', '提前批', '不限，商科优先', '企业官网招聘页'],
  ['绿能新能源', '电池研发工程师', '新能源企业', '新能源', '技术', '常州', '硕士', 20, 32, 1, '2027', '秋招批', '材料/化学/机械', '校招信息汇总表'],
  ['澄明金融科技', '数据分析师', '金融机构', '金融', '职能', '上海', '硕士', 18, 27, 1, '2027', '秋招批', '统计/数学/计算机', '企业官网招聘页'],
  ['经纬智造', '智能制造管培生', '制造业龙头', '高端制造', '职能', '武汉', '本科', 12, 18, 0, '2027', '秋招批', '机械/自动化', '校招信息汇总表'],
  ['启航教育', '用户运营专员', '教育企业', '教育', '运营', '广州', '本科', 10, 16, 0, '2027', '秋招批', '不限', '企业官网招聘页'],
  ['蓝湾生物', '医药市场助理', '生物医药', '生物医药', '市场', '南京', '本科', 11, 16, 0, '2027', '秋招批', '医药/市场相关', '校招信息汇总表'],
  ['盛达消费', '品牌营销管培生', '快消企业', '快消', '市场', '上海', '本科', 12, 18, 0, '2027', '提前批', '不限', '企业官网招聘页'],
  ['磐石物流', '供应链运营岗', '物流企业', '物流', '运营', '成都', '本科', 9, 14, 0, '2027', '秋招批', '物流/管理', '校招信息汇总表'],
  ['天枢云', '云原生开发工程师', '科技独角兽', '云计算', '技术', '深圳', '硕士', 24, 38, 1, '2027', '秋招批', '计算机', '企业官网招聘页'],
  ['东望证券', '金融科技岗', '金融机构', '金融', '技术', '上海', '硕士', 20, 30, 1, '2027', '秋招批', '金融工程/计算机', '校招信息汇总表'],
  ['青藤游戏', '游戏客户端开发', '互联网企业', '游戏', '技术', '广州', '本科', 20, 32, 1, '2027', '提前批', '计算机', '企业官网招聘页'],
  ['智行汽车', '自动驾驶测试工程师', '新能源车企', '汽车', '技术', '北京', '本科', 18, 28, 1, '2027', '秋招批', '车辆/计算机/控制', '校招信息汇总表'],
  ['禾风传媒', '内容运营（新媒体）', '传媒企业', '传媒', '运营', '北京', '本科', 10, 16, 0, '2027', '秋招批', '不限', '校招信息汇总表'],
  ['安澜保险', '精算岗（校招）', '金融机构', '保险', '职能', '上海', '硕士', 16, 24, 1, '2027', '秋招批', '精算/数学/统计', '企业官网招聘页'],
  ['瑞景地产', '人力资源管培生', '地产企业', '地产', '职能', '北京', '本科', 11, 16, 0, '2027', '秋招批', '人力/管理', '校招信息汇总表'],
  ['澜图设计', 'UI/UX 设计师', '互联网企业', '互联网', '市场', '杭州', '本科', 13, 20, 0, '2027', '提前批', '设计相关', '企业官网招聘页'],
  ['沐光新能源', '光伏系统工程师', '新能源企业', '新能源', '技术', '西安', '本科', 13, 20, 1, '2027', '秋招批', '电气/能源/物理', '校招信息汇总表'],
  ['飞驰出行', '策略产品经理', '互联网企业', '出行', '产品', '北京', '本科', 17, 26, 0, '2027', '秋招批', '不限', '企业官网招聘页'],
  ['橡树资本', '投研助理（量化方向）', '金融机构', '金融', '职能', '上海', '硕士', 22, 35, 1, '2027', '提前批', '金融/数学/计算机', '校招信息汇总表'],
  ['微澜电商', '电商运营管培生', '互联网企业', '电商', '运营', '杭州', '本科', 11, 17, 0, '2027', '秋招批', '不限', '校招信息汇总表'],
  ['极光软件', '测试开发工程师', '软件企业', '软件', '技术', '成都', '本科', 14, 22, 1, '2027', '秋招批', '计算机', '企业官网招聘页'],
];

function daysFromNow(n) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** 生成演示岗位行：截止日期围绕「今天」动态分布，保证日历演示始终有效 */
function buildRows() {
  const offsets = [2, 3, 4, 6, 8, 10, 13, 16, 20, 25];
  return POOL.map((p, i) => {
    const [company, position, company_type, industry, job_category, location, education_required, salary_min, salary_max, hasWritten, session_year, batch, major_requirement, source] = p;
    return {
      company, position, company_type, industry, job_category, location, education_required,
      salary_min, salary_max, has_written_test: hasWritten, session_year, batch, major_requirement, source,
      deadline: daysFromNow(offsets[i % offsets.length]),
    };
  });
}

/** 执行一次同步：入库新岗位 / 刷新截止日期，返回统计 */
async function runSyncOnce() {
  const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
  const rows = buildRows();
  let added = 0, updated = 0;
  tx(() => {
    for (const r of rows) {
      const exist = db.prepare('SELECT id FROM jobs WHERE company = ? AND position = ? AND session_year = ?').get(r.company, r.position, r.session_year);
      if (exist) {
        db.prepare('UPDATE jobs SET deadline=?, synced_at=?, salary_min=?, salary_max=?, has_written_test=? WHERE id=?')
          .run(r.deadline, now, r.salary_min, r.salary_max, r.has_written_test, exist.id);
        updated++;
      } else {
        db.prepare(`INSERT INTO jobs (company, position, company_type, industry, job_category, location, education_required, salary_min, salary_max, deadline, has_written_test, session_year, batch, major_requirement, source, synced_at)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
          .run(r.company, r.position, r.company_type, r.industry, r.job_category, r.location, r.education_required, r.salary_min, r.salary_max, r.deadline, r.has_written_test, r.session_year, r.batch, r.major_requirement, r.source, now);
        added++;
      }
    }
  });
  const total = all('SELECT COUNT(*) AS c FROM jobs')[0].c;
  return { added, updated, total, synced_at: now };
}

// 独立脚本入口：node server/sync.js
if (require.main === module) {
  runSyncOnce().then((r) => {
    console.log(`[同步完成] 新增 ${r.added}，刷新 ${r.updated}，当前共 ${r.total} 条岗位，同步时间 ${r.synced_at}`);
  }).catch((e) => {
    console.error('[同步失败]', e);
    process.exit(1);
  });
}

module.exports = { runSyncOnce };
