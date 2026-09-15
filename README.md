# 秋招作战台 v2（Qiuzhao Workbench v2）

面向 **2027 届校招求职者**的一站式求职工作台，覆盖「岗位发现 → 简历定制 → 经历深挖 → 面试准备 → 复盘沉淀」全流程。纯 Web 端，PC / 移动端自适应。

> 一个网页搞定秋招全流程，从投简历到拿 offer。

## ✨ 六大核心模块

| 模块 | 说明 |
| --- | --- |
| 📡 岗位雷达 | 聚合真实公开校招岗位（4200+ 条）、多维筛选（企业性质 / 行业 / 岗位大类 / 地点 / 学历 / 批次）、一键加入投递计划、手动 / 每日自动同步 |
| 🗓 今日作战日历 | 按网申截止日期升序的时间轴，可自定义预警阈值（截止前 N 天标橙 / 标红），「尽快投递」类岗位保留原文标注 |
| 📄 定制简历 | 通用简历（粘贴或上传 Word/PDF）× 岗位 JD → 一键生成定制版 + 岗位匹配度评分 + 逐段优化建议，自动脱敏、版本自动入库 |
| ❖ 经历资产 | 简历自动拆解为结构化经历卡片（教育 / 实习 / 项目 / 技能），AI 教练逐轮追问（每轮 3 问），2-3 轮后可沉淀 |
| ⚑ 面试作战 | 基于 JD 预测 4 模块题库（行为 / 专业 / HR / 公司专属，每题附为什么问 + 回答证据 + 回答结构）；AI 模拟面试实时评分 + 踩分点分析，结束输出复盘报告（每日限 3 次）；支持导入录音转文字自动复盘 |
| ◫ 知识库 | 文本 / 文件 (Word/PDF/TXT) / 链接 / 图片 OCR 录入，按行业 / 公司 / 模块归档，关键词搜索，AI 问答自动调取知识库 |

## 🚀 快速开始

要求：Node.js ≥ 22.5（使用内置 SQLite，零原生依赖）

```bash
npm install        # 安装依赖
npm run seed       # 初始化数据（演示账号 + 岗位库 + 示例投递/知识库）
npm start          # 启动服务 → http://localhost:3000
```

**演示账号**：`demo@qiuzhao.dev` / `demo1234`（也可自行注册）

### AI 能力（可选）

不配置也可用：内置演示引擎（规则 + 模板）保证全流程可跑通，页面右上角会标注「内置演示引擎」。

要启用**真实大模型 AI**（简历生成 / 面试评分 / 复盘 / 问答 / 图片 OCR），设置环境变量后重启：

```bash
AI_API_KEY=sk-xxx
AI_BASE_URL=https://api.openai.com/v1   # 兼容 OpenAI 协议的任意端点
AI_MODEL=gpt-4o-mini
AI_VISION_MODEL=gpt-4o-mini             # 图片 OCR 用，默认跟随 AI_MODEL
npm start
```

> 本产品独立开发，AI 能力注明基于第三方大模型 API 开发，不宣称官方合作 / 联合出品。

## 🏗 技术架构

```
qiuzhao-workbench/
├── server/                  # Node.js 后端（Express）
│   ├── index.js             # 服务入口 + 每日 03:00 定时同步（node-cron）
│   ├── db.js                # 数据层（Node 内置 SQLite，WAL 模式）
│   ├── auth.js              # 邮箱+密码注册登录，JWT 鉴权（crypto.scrypt 哈希）
│   ├── sync.js              # 岗位同步引擎：GitHub 公开源 + 飞书源自动拉取/缓存合并 + 离线演示回退
│   ├── import-feishu.js     # 飞书多维表格数据源手动刷新入口（每日 03:00 也会自动执行）
│   ├── seed.js              # 种子数据（演示账号/岗位/投递/知识库）
│   ├── fileparse.js         # Word/PDF/TXT 文本提取
│   ├── ai/service.js        # AI 服务层（LLM API + 内置演示引擎双模式）
│   └── routes/              # 6 大模块 REST API
├── public/                  # 前端 SPA（原生 HTML/CSS/JS，哈希路由）
│   ├── index.html
│   ├── css/app.css
│   └── js/
│       ├── app.js           # 外壳/路由/认证/通用组件
│       ├── api.js           # API 客户端（JWT 注入、401 处理）
│       └── modules/         # 各模块页面
└── data/                    # SQLite 数据库（运行时生成，已 gitignore）
```

- **前端**：单页应用（HTML/CSS/JS），响应式布局，无需构建
- **后端**：Node.js + Express REST API
- **数据库**：SQLite（本地零配置即用；数据访问层已解耦，可按需迁移 PostgreSQL）
- **认证**：邮箱 + 密码 + JWT（7 天有效期）
- **定时任务**：每日 03:00 自动同步岗位

### API 一览

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | /api/auth/register · /api/auth/login | 注册 / 登录 |
| GET | /api/jobs · /api/jobs/facets · /api/jobs/:id | 岗位列表 / 筛选维度 / 详情 |
| POST | /api/jobs/sync | 手动触发同步 |
| GET/POST | /api/calendar · /api/applications | 投递计划列表 / 加入投递 |
| PATCH/DELETE | /api/applications/:id | 更新状态备注 / 移除 |
| GET/PUT | /api/calendar/settings | 预警阈值 |
| POST | /api/resumes/generate · GET /api/resumes | 生成定制简历 / 版本库 |
| POST | /api/experiences/parse · GET/POST /api/experiences | 简历拆解 / 经历卡片 |
| POST | /api/experiences/:id/coach · /settle | AI 教练追问 / 沉淀 |
| POST | /api/interviews/predict · /sessions | 题库预测 / 开始模拟面试 |
| POST | /api/interviews/sessions/:id/answer | 提交答案并评分 |
| GET | /api/interviews/sessions/:id/report | 复盘报告 |
| POST | /api/interviews/reviews | 面试复盘解析 |
| GET | /api/interviews/dashboard | 面试看板 |
| GET/POST | /api/knowledge · /api/knowledge/import | 资料列表 / 录入 |
| POST | /api/knowledge/ask | 知识库 AI 问答 |
| GET | /api/dashboard | 总览看板 |

## 📡 岗位数据源

- **主数据源（真实·自动）**：公开 GitHub 仓库 [HU-eun/campus-recruitment](https://github.com/HU-eun/campus-recruitment)（2027 届校招信息汇总平台，约 7200+ 条记录，GitHub Actions 每日从飞书多维表格自动更新）。
- **第二数据源（用户自建飞书多维表格）**：`server/import-feishu.js` 从你分享的「校招汇总表（优先）」拉取全量记录（约 1.1 万条），过滤非 2027 届后导入（约 2200+ 条新增岗位），数据缓存于本地 `data/feishu-jobs.json`（已 gitignore，不进入公开仓库）。表更新后重跑 `node server/import-feishu.js` 即可刷新。
- **多源去重**：按「公司 + 岗位 + 批次 + 届次」去重，同岗位已由其他数据源提供时不覆盖，两个来源互不覆盖、可同时保留。
- **接入方式**：`server/sync.js` 每日 03:00（node-cron）**先自动拉取你的飞书多维表格最新记录**，再拉取 GitHub 公开源，合并去重入库——与飞书表自身的每日更新保持同步；自动过滤非 2027 届 / 指南类记录，标准化字段（截止时间兼容「尽快投递 / 招满为止」、批次归一化、学历档位、岗位大类推断）。岗位雷达页的「↻ 立即同步」按钮则快速拉取 GitHub 源并合并已缓存的飞书数据。
- **离线回退**：网络不可用时自动切换内置演示池（26 条虚构企业岗位），保证产品可演示。
- **数据可追溯**：每条岗位保留官方公告 / 投递链接（详情弹窗可直接跳转），来源字段标注具体数据源。

## 🔐 知识产权与合规边界

1. 产品名称与界面为独立设计，不照搬第三方模板与品牌
2. **岗位数据**：默认接入公开校招信息汇总平台，仅使用公开可访问的招聘信息，每条岗位保留官方公告 / 投递链接与来源标注；网络不可用时自动回退内置演示池（虚构企业，仅用于功能演示）
3. 简历模板排版为原创设计
4. AI 能力注明「基于大模型 API 开发」，不宣称官方合作
5. 用户数据仅本人可见；演示模式下简历自动脱敏（姓名 / 电话 / 邮箱）

## 🗺 迭代路线图

- [ ] 语音 / 视频模拟面试（接入语音模型）
- [ ] 移动端 App / 小程序
- [ ] 多人协作（组队求职 / 内推）
- [ ] 数据看板（投递转化率 / 面试率分析）
- [ ] 手机端日历同步 + 每日消息推送
- [ ] PostgreSQL 迁移 + RLS 行级安全
