'use strict';
/**
 * 种子数据：创建演示账号 + 初始化岗位库 + 为演示账号加入示例投递计划
 * 用法：npm run seed
 */
const { get, run, all } = require('./db');
const { runSyncOnce } = require('./sync');

async function seed() {
  const r = await runSyncOnce();
  console.log(`岗位库就绪：新增 ${r.added}，刷新 ${r.updated}，共 ${r.total} 条`);

  let demo = get('SELECT * FROM users WHERE email = ?', ['demo@qiuzhao.dev']);
  if (!demo) {
    const { hashPassword } = require('./auth');
    const ir = run('INSERT INTO users (email, name, password_hash) VALUES (?,?,?)', ['demo@qiuzhao.dev', '演示用户', hashPassword('demo1234')]);
    demo = get('SELECT * FROM users WHERE id = ?', [ir.lastInsertRowid]);
    run('INSERT OR IGNORE INTO user_settings (user_id) VALUES (?)', [demo.id]);
    console.log('演示账号已创建：demo@qiuzhao.dev / demo1234');
  } else {
    console.log('演示账号已存在：demo@qiuzhao.dev / demo1234');
  }

  // 为演示账号加入几条示例投递（选择截止最近的一批岗位）
  const existing = get('SELECT COUNT(*) AS c FROM applications WHERE user_id = ?', [demo.id]).c;
  if (existing === 0) {
    const jobs = all('SELECT id, deadline FROM jobs ORDER BY deadline ASC LIMIT 8');
    const statuses = ['planned', 'planned', 'applied', 'applied', 'written_test', 'interview', 'planned', 'rejected'];
    jobs.forEach((j, i) => {
      run('INSERT OR IGNORE INTO applications (user_id, job_id, status, note) VALUES (?,?,?,?)',
        [demo.id, j.id, statuses[i] || 'planned', i < 3 ? '今日优先处理' : '']);
    });
    console.log(`已为演示账号加入 ${jobs.length} 条示例投递计划`);
  }

  // 示例知识库资料
  const kb = get('SELECT COUNT(*) AS c FROM knowledge_docs WHERE user_id = ?', [demo.id]).c;
  if (kb === 0) {
    const samples = [
      ['秋招时间线备忘', 'manual', '互联网', '', '求职规划', '2027 届秋招：7-8 月提前批投递，9-10 月秋招高峰，10-11 月笔试面试集中，11-12 月补录。建议每周日复盘一次投递漏斗。', '内置示例'],
      ['技术面试高频题（后端）', 'manual', '互联网', '', '面试准备', '1. 进程与线程的区别 2. 索引为什么快 3. 缓存穿透/击穿/雪崩 4. 分布式一致性 5. 手写 LRU。每题用「概念-场景-方案-细节」四步作答。', '内置示例'],
      ['STAR 法则笔记', 'manual', '互联网', '', '面试准备', 'STAR = 情境(Situation) + 任务(Task) + 行动(Action) + 结果(Result)。每个面试故事控制在 90 秒，行动部分至少占 60%，结果必须有数字。', '内置示例'],
      ['某公司面经复盘', 'manual', '互联网', '星舟网络', '面试复盘', '一面：自我介绍 + 项目深挖 + 算法题；二面：系统设计 + 行为面；HR 面：薪资期望与到岗时间。建议准备 3 个不同深度的项目故事。', '内置示例'],
    ];
    for (const [title, doc_type, industry, company, module, content, source] of samples) {
      run('INSERT INTO knowledge_docs (user_id, title, doc_type, industry, company, module, content, source) VALUES (?,?,?,?,?,?,?,?)',
        [demo.id, title, doc_type, industry, company, module, content, source]);
    }
    console.log('已写入 4 条示例知识库资料');
  }

  console.log('种子数据完成。启动：npm start，演示账号 demo@qiuzhao.dev / demo1234');
}

seed().catch((e) => { console.error('种子数据失败:', e); process.exit(1); });
