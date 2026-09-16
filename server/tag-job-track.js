'use strict';
/**
 * 岗位方向标签（job_track）—— 基于岗位名称关键词的确定性规则，可追溯
 * 目的：把"技术"大类细分出测试/技术支持/运维等中低难度方向，方便工科生快速筛出适合自己的岗位
 * 规则优先级从高到低（命中即归类）：
 *   数据标注类 → 测试类 → 运维类 → 技术支持类 → 产品类 → 运营类 → 市场销售类 → 职能类 → 数据类 → 研发类 → 管培类 → 其他
 */
const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync('E:/Q/qiuzhao-workbench/data/qiuzhao.db');

// 建列（幂等）
try { db.exec('ALTER TABLE jobs ADD COLUMN job_track TEXT'); console.log('[列已创建] job_track'); }
catch { console.log('[列已存在] job_track'); }

const RULES = [
  { track: '数据标注类', kws: ['数据标注', '标注', '审核', '内容审核', '数据清洗', '打标'] },
  { track: '测试类', kws: ['测试', 'qa', '质检', '质量', '验证工程师', '测开'] },
  { track: '运维类', kws: ['运维', '网络工程师', '网工', 'idc', '基础设施', '网优', '网络优化'] },
  { track: '技术支持类', kws: ['技术支持', '售前', '售后', '应用工程师', 'fae', '解决方案', '实施', '交付', '技术服务', '客服', '工艺工程师'] },
  { track: '产品类', kws: ['产品经理', '产品专员', '产品运营', '产品助理', '产品策划'] },
  { track: '运营类', kws: ['运营', '新媒体', '内容编辑', '用户运营', '社群', '主播', '直播'] },
  { track: '市场销售类', kws: ['市场', '营销', '销售', '商务', 'bd', '渠道', '品牌', '公关', '招商', '外贸业务'] },
  { track: '职能类', kws: ['财务', '会计', '人力', 'hr', '行政', '法务', '审计', '党建', '采购', '供应链', '合规', '证券事务', '董秘', '文秘', '后勤'] },
  { track: '数据类', kws: ['数据分析', '数据运营', '数据产品', '大数据', '数仓', '数据开发', '数据工程'] },
  { track: '管培类', kws: ['管培生', '管理培训生', '储备', '青苗', '雏鹰', '启航'] },
];

const total = db.prepare('SELECT COUNT(*) c FROM jobs').get().c;
const rows = db.prepare('SELECT id, position FROM jobs').all();
const upd = db.prepare('UPDATE jobs SET job_track = ? WHERE id = ?');

const dist = {};
let unmatched = 0;
for (const r of rows) {
  const pos = String(r.position || '').toLowerCase();
  let track = null;
  for (const rule of RULES) {
    if (rule.kws.some((k) => pos.includes(k.toLowerCase()))) { track = rule.track; break; }
  }
  if (!track) {
    // 单名词工程技术岗兜底（岗位名=领域名，多为工程师岗位的简写）
    if (/人工智能|智能|机械|电子|电气|自动化|通信|半导体|芯片|材料|化工|能源|车辆|汽车|航空|航天|软件|计算机|信息|网络|光电|光学|工程|控制|机器人|无人机|电力|仪器|计量|仿真|射频|微波|信号|制造|交互|动画|数字|硬件|集成电路|ic设计|fpga/.test(pos)) track = '研发类';
    else if (/产品|游戏策划/.test(pos)) track = '产品类';
    else if (/数据/.test(pos)) track = '数据类';
    else if (/管理|人事|项目|风控|投融资|证券|保险|银行|柜员|咨询|调研|物流|行政|文员|人力资源|职能/.test(pos)) track = '职能类';
    else if (/校园大使|客户经理|商务/.test(pos)) track = '市场销售类';
    else if (/工艺|生产|设备|售后/.test(pos)) track = '技术支持类';
    else if (/研发|开发|算法|工程师|研究员|架构|嵌入式|芯片|ic|fpga|硬件|软件|java|python|c\+\+|前端|后端|ai|机器学习|深度学习|技术|设计|仿真/.test(pos)) track = '研发类';
    else if (/管培|培训生/.test(pos)) track = '管培类';
    else { track = '其他'; unmatched++; }
  }
  dist[track] = (dist[track] || 0) + 1;
  upd.run(track, r.id);
}
db.exec('CREATE INDEX IF NOT EXISTS idx_jobs_track ON jobs(job_track)');

console.log('=== 标签分布 ===');
for (const [k, v] of Object.entries(dist).sort((a, b) => b[1] - a[1])) console.log(`${k}: ${v}`);
console.log(`总计 ${total} 条，未匹配(其他): ${unmatched}`);
db.close();
