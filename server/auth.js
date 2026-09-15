'use strict';
/**
 * 认证：邮箱 + 密码注册登录，JWT 鉴权
 * 密码哈希使用 Node 内置 crypto.scrypt（无第三方依赖）。
 */
const crypto = require('node:crypto');
const jwt = require('jsonwebtoken');
const express = require('express');
const fs = require('node:fs');
const path = require('node:path');
const { get, run } = require('./db');

// JWT 密钥：优先环境变量，否则持久化到 data/.secret（重启后令牌仍有效）
let secret = process.env.JWT_SECRET;
if (!secret) {
  const secretPath = path.join(__dirname, '..', 'data', '.secret');
  if (fs.existsSync(secretPath)) {
    secret = fs.readFileSync(secretPath, 'utf8').trim();
  } else {
    secret = crypto.randomBytes(32).toString('hex');
    fs.writeFileSync(secretPath, secret, { mode: 0o600 });
  }
}
const TOKEN_TTL = '7d';

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, hash] = stored.split(':');
  const calc = crypto.scryptSync(password, salt, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(calc, 'hex'));
}

function signToken(user) {
  return jwt.sign({ uid: user.id, email: user.email, name: user.name }, secret, { expiresIn: TOKEN_TTL });
}

/** JWT 鉴权中间件 */
function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: '未登录或登录已过期' });
  try {
    const payload = jwt.verify(token, secret);
    req.user = { id: payload.uid, email: payload.email, name: payload.name };
    next();
  } catch {
    return res.status(401).json({ error: '未登录或登录已过期' });
  }
}

const router = express.Router();

router.post('/register', (req, res) => {
  const { email, password, name } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: '邮箱和密码必填' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: '邮箱格式不正确' });
  if (String(password).length < 6) return res.status(400).json({ error: '密码至少 6 位' });
  const displayName = (name || email.split('@')[0]).trim().slice(0, 30);
  try {
    const r = run(
      'INSERT INTO users (email, name, password_hash) VALUES (?, ?, ?)',
      [email.toLowerCase(), displayName, hashPassword(password)]
    );
    const user = get('SELECT id, email, name, created_at FROM users WHERE id = ?', [r.lastInsertRowid]);
    run('INSERT OR IGNORE INTO user_settings (user_id) VALUES (?)', [user.id]);
    return res.json({ token: signToken(user), user });
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) return res.status(409).json({ error: '该邮箱已注册' });
    return res.status(500).json({ error: '注册失败，请重试' });
  }
});

router.post('/login', (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: '邮箱和密码必填' });
  const user = get('SELECT * FROM users WHERE email = ?', [email.toLowerCase()]);
  if (!user || !verifyPassword(password, user.password_hash)) {
    return res.status(401).json({ error: '邮箱或密码错误' });
  }
  run('INSERT OR IGNORE INTO user_settings (user_id) VALUES (?)', [user.id]);
  return res.json({
    token: signToken(user),
    user: { id: user.id, email: user.email, name: user.name, created_at: user.created_at },
  });
});

router.get('/me', requireAuth, (req, res) => {
  return res.json({ user: req.user });
});

module.exports = { router, requireAuth, signToken, hashPassword };
