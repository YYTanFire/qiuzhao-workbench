'use strict';
/**
 * 秋招作战台 v2 —— 服务入口
 * 启动：npm start（默认 http://localhost:3000）
 */
const path = require('node:path');
const express = require('express');
const cron = require('node-cron');
const fs = require('node:fs');
const { db, all } = require('./db');
const { runSyncOnce } = require('./sync');

const PORT = Number(process.env.PORT) || 3000;
const app = express();

app.use(express.json({ limit: '25mb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));

// 健康检查
app.get('/api/health', (req, res) => res.json({ ok: true, name: '秋招作战台 v2', time: new Date().toISOString() }));

// 模块路由
app.use('/api/auth', require('./routes/../auth').router);
app.use('/api/jobs', require('./routes/jobs'));
app.use('/api/calendar', require('./routes/calendar'));
app.use('/api/applications', require('./routes/calendar'));
app.use('/api/resumes', require('./routes/resumes'));
app.use('/api/experiences', require('./routes/experiences'));
app.use('/api/interviews', require('./routes/interviews'));
app.use('/api/knowledge', require('./routes/knowledge'));
app.use('/api/dashboard', require('./routes/dashboard'));

// 统一错误处理
app.use((err, req, res, next) => {
  console.error('[server error]', err);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: '服务器内部错误：' + err.message });
});

// 启动时：确保有岗位数据（首次自动同步），随后注册每日凌晨同步任务
async function bootstrap() {
  const count = all('SELECT COUNT(*) AS c FROM jobs')[0].c;
  if (count === 0) {
    const r = await runSyncOnce();
    console.log(`[首次同步] 岗位库初始化完成，共 ${r.total} 条`);
  }
  // 每日 03:00 自动拉取最新岗位（演示数据源刷新截止日期；接入真实源后此处不变）
  cron.schedule('0 3 * * *', async () => {
    try {
      const r = await runSyncOnce();
      console.log(`[定时同步] ${new Date().toLocaleString('zh-CN')} 新增 ${r.added}，刷新 ${r.updated}，共 ${r.total} 条`);
    } catch (e) {
      console.error('[定时同步失败]', e.message);
    }
  });
  console.log(`[定时任务] 每日 03:00 自动同步岗位已注册`);

  app.listen(PORT, () => {
    console.log('------------------------------------------');
    console.log('  秋招作战台 v2 已启动');
    console.log(`  访问地址: http://localhost:${PORT}`);
    console.log(`  演示账号: demo@qiuzhao.dev / demo1234`);
    console.log(`  AI 模式: ${process.env.AI_API_KEY ? '真实大模型 API' : '内置演示引擎（配置 AI_API_KEY 启用真实 AI）'}`);
    console.log('------------------------------------------');
  });
}

bootstrap().catch((e) => { console.error('启动失败:', e); process.exit(1); });

process.on('SIGINT', () => { db.close(); process.exit(0); });
