'use strict';
/**
 * 数据库层：基于 Node 内置 SQLite（零原生依赖）
 * 结构上保持数据访问与具体存储解耦，便于后续迁移 PostgreSQL（见 README）。
 */
const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const fs = require('node:fs');

const DATA_DIR = path.join(__dirname, '..', 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });
const DB_PATH = path.join(DATA_DIR, 'qiuzhao.db');

const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA busy_timeout = 15000;');
db.exec('PRAGMA foreign_keys = ON;');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company TEXT NOT NULL,
  position TEXT NOT NULL,
  company_type TEXT,
  industry TEXT,
  job_category TEXT,
  location TEXT,
  education_required TEXT,
  salary_min INTEGER,
  salary_max INTEGER,
  deadline TEXT,
  has_written_test INTEGER NOT NULL DEFAULT 0,
  session_year TEXT,
  batch TEXT,
  major_requirement TEXT,
  source TEXT,
  synced_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS applications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  job_id INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'planned',
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  UNIQUE(user_id, job_id)
);

CREATE TABLE IF NOT EXISTS user_settings (
  user_id INTEGER PRIMARY KEY,
  warn_days INTEGER NOT NULL DEFAULT 7,
  urgent_days INTEGER NOT NULL DEFAULT 3,
  updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS resume_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  job_id INTEGER,
  job_title TEXT,
  title TEXT,
  content_json TEXT,
  score INTEGER,
  suggestions TEXT,
  mode TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS experience_cards (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  card_type TEXT NOT NULL,
  title TEXT,
  org TEXT,
  period TEXT,
  content TEXT,
  tags TEXT,
  source_resume TEXT,
  settled INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS coach_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  card_id INTEGER NOT NULL,
  round INTEGER NOT NULL DEFAULT 1,
  history TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS interview_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  job_id INTEGER,
  job_title TEXT,
  company TEXT,
  rounds_json TEXT,
  current_question INTEGER NOT NULL DEFAULT 0,
  answers_json TEXT NOT NULL DEFAULT '[]',
  score INTEGER,
  report TEXT,
  status TEXT NOT NULL DEFAULT 'ongoing',
  mode TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS interview_reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  job_id INTEGER,
  job_title TEXT,
  company TEXT,
  transcript TEXT,
  analysis TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS interview_quota (
  user_id INTEGER NOT NULL,
  day TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, day)
);

CREATE TABLE IF NOT EXISTS knowledge_docs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  doc_type TEXT NOT NULL DEFAULT 'text',
  industry TEXT,
  company TEXT,
  module TEXT,
  content TEXT,
  source TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE INDEX IF NOT EXISTS idx_jobs_filter ON jobs(session_year, company_type, industry, job_category, location);
CREATE INDEX IF NOT EXISTS idx_applications_user ON applications(user_id, status);
CREATE INDEX IF NOT EXISTS idx_knowledge_user ON knowledge_docs(user_id);
`;

db.exec(SCHEMA);

// ---- 轻量迁移：老库补充新增列（幂等） ----
const EXTRA_COLS = {
  jobs: [
    ['deadline_text', "TEXT"],
    ['official_url', "TEXT"],
    ['apply_url', "TEXT"],
    ['is_demo', "INTEGER NOT NULL DEFAULT 0"],
    ['company_url', "TEXT"],
    ['reliable', "INTEGER NOT NULL DEFAULT 0"],
    ['job_track', "TEXT"],
  ],
};
for (const [table, cols] of Object.entries(EXTRA_COLS)) {
  const existing = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name));
  for (const [name, type] of cols) {
    if (!existing.has(name)) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${type}`);
    }
  }
}

// 历史兼容：v1 演示岗位（来源为旧演示源名）回填 is_demo=1，避免被误判为真实数据
db.exec(`UPDATE jobs SET is_demo = 1 WHERE is_demo = 0 AND source IN ('企业官网招聘页', '校招信息汇总表')`);

/** 运行参数化查询并返回所有行 */
function all(sql, params = []) {
  return db.prepare(sql).all(...params);
}

/** 运行参数化查询并返回首行 */
function get(sql, params = []) {
  return db.prepare(sql).get(...params);
}

/** 执行写入，返回 { changes, lastInsertRowid } */
function run(sql, params = []) {
  return db.prepare(sql).run(...params);
}

/** 事务包装 */
function tx(fn) {
  db.exec('BEGIN');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

module.exports = { db, all, get, run, tx, DB_PATH };
