'use strict';
/**
 * 应用外壳：哈希路由、登录态、导航、页面装载、通用 UI 工具
 */
(function () {
  const PAGES = {
    'dashboard': { title: '总览', desc: '秋招全局态势，一眼掌握', mod: Dashboard },
    'radar': { title: '岗位雷达', desc: '聚合岗位 · 多维筛选 · 一键加入投递', mod: Radar },
    'calendar': { title: '今日作战', desc: '按截止日期排列的投递作战时间轴', mod: Calendar },
    'resume': { title: '定制简历', desc: '通用简历 × 岗位 JD → 定制版 + 评分建议', mod: Resume },
    'experience': { title: '经历资产', desc: '简历自动拆解 · AI 教练深挖 · 素材沉淀', mod: Experience },
    'interview': { title: '面试作战', desc: '题库预测 · AI 模拟面试 · 复盘沉淀', mod: Interview },
    'knowledge': { title: '知识库', desc: '面经资料归档 · 搜索 · AI 问答', mod: Knowledge },
  };
  const NAV = [
    { id: 'dashboard', ico: '▦', label: '总览' },
    { id: 'radar', ico: '◎', label: '岗位雷达' },
    { id: 'calendar', ico: '◷', label: '今日作战' },
    { id: 'resume', ico: '▤', label: '定制简历' },
    { id: 'experience', ico: '❖', label: '经历资产' },
    { id: 'interview', ico: '⚑', label: '面试作战' },
    { id: 'knowledge', ico: '◫', label: '知识库' },
  ];

  const app = document.getElementById('app');
  let current = null;
  let aiEnabled = null;

  /* ---------- 通用工具 ---------- */
  function toast(msg, type = '') {
    const root = document.getElementById('toast-root');
    const t = document.createElement('div');
    t.className = 'toast ' + type;
    t.textContent = msg;
    root.appendChild(t);
    setTimeout(() => { t.style.opacity = '0'; t.style.transition = 'opacity .3s'; setTimeout(() => t.remove(), 320); }, 2600);
  }
  function esc(s) { return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  function todayStr() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
  function daysLeft(deadline) {
    if (!deadline) return null;
    const dl = new Date(deadline + 'T00:00:00');
    const t = new Date(); t.setHours(0, 0, 0, 0);
    return Math.round((dl - t) / 86400000);
  }
  function deadlineChip(deadline, cls = '') {
    const d = daysLeft(deadline);
    if (d == null) return '<span class="deadline-chip dl-normal">截止未知</span>';
    if (d < 0) return `<span class="deadline-chip dl-expired">已截止 ${-d} 天</span>`;
    if (d === 0) return '<span class="deadline-chip dl-urgent">今日截止</span>';
    if (d <= 3) return `<span class="deadline-chip dl-urgent">${d} 天后截止</span>`;
    if (d <= 7) return `<span class="deadline-chip dl-warn">${d} 天后截止</span>`;
    return `<span class="deadline-chip dl-normal">${d} 天后截止</span>`;
  }
  function fmtSalary(s) { return s && s.salary_min ? `${s.salary_min}–${s.salary_max}K` : '面议'; }
  function fmtDate(iso) { return iso ? String(iso).slice(0, 10) : ''; }
  function avatarName(name) { return (name || '用').slice(0, 1).toUpperCase(); }
  function spinner() { return '<div class="spinner"></div>'; }
  function emptyBox(text, ico = '🗂') { return `<div class="empty"><div class="ico">${ico}</div><div>${text}</div></div>`; }
  function statusPill(status) {
    const map = { planned: ['待投递', 'pill-gray'], applied: ['已投递', 'pill-blue'], written_test: ['笔试中', 'pill-sky'], interview: ['面试中', 'pill-amber'], offer: ['已拿 Offer', 'pill-green'], rejected: ['已淘汰', 'pill-red'] };
    const [label, cls] = map[status] || ['待投递', 'pill-gray'];
    return `<span class="pill ${cls}">${label}</span>`;
  }
  function openModal(html, { lg = false } = {}) {
    const mask = document.createElement('div');
    mask.className = 'modal-mask';
    mask.innerHTML = `<div class="modal ${lg ? 'lg' : ''}">${html}</div>`;
    mask.addEventListener('mousedown', (e) => { if (e.target === mask) mask.remove(); });
    document.body.appendChild(mask);
    return mask;
  }
  function closeModal(mask) { mask && mask.remove(); }
  function confirmDialog(message, onOk) {
    const mask = openModal(`
      <div class="modal-head"><h3>确认操作</h3><button class="modal-close" data-close>×</button></div>
      <div class="modal-body"><p style="font-size:14px;line-height:1.8">${esc(message)}</p></div>
      <div class="modal-foot"><button class="btn" data-close>取消</button><button class="btn btn-primary" data-ok>确认</button></div>`);
    const ok = mask.querySelector('[data-ok]');
    ok.addEventListener('click', () => { mask.remove(); onOk(); });
    mask.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => mask.remove()));
  }
  function fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result.split(',')[1]);
      r.onerror = reject;
      r.readAsDataURL(file);
    });
  }
  function readFileText(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = reject;
      r.readAsText(file);
    });
  }
  function imageToDataUrl(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = reject;
      r.readAsDataURL(file);
    });
  }
  // 拖拽上传辅助：给 dropzone 绑定 drag/drop
  function bindDropzone(el, onFile) {
    el.addEventListener('click', () => { const inp = document.createElement('input'); inp.type = 'file'; inp.onchange = () => onFile(inp.files[0]); inp.click(); });
    el.addEventListener('dragover', (e) => { e.preventDefault(); el.classList.add('over'); });
    el.addEventListener('dragleave', () => el.classList.remove('over'));
    el.addEventListener('drop', (e) => { e.preventDefault(); el.classList.remove('over'); onFile(e.dataTransfer.files[0]); });
  }

  /* ---------- 认证视图 ---------- */
  function renderAuth() {
    app.innerHTML = `
      <div class="auth-wrap">
        <div class="auth-card">
          <div class="auth-brand">
            <div class="auth-logo">战</div>
            <div>
              <div class="auth-title">秋招作战台</div>
              <div class="auth-sub">2027 届校招 · 一站式求职工作台 · v2</div>
            </div>
          </div>
          <div class="auth-tabs">
            <button id="tab-login" class="on">登录</button>
            <button id="tab-reg">注册</button>
          </div>
          <form id="auth-form">
            <div id="auth-fields">
              <div class="field"><label>邮箱</label><input id="a-email" type="email" placeholder="you@example.com" /></div>
              <div class="field"><label>密码</label><input id="a-pwd" type="password" placeholder="至少 6 位" /></div>
            </div>
            <button class="btn btn-primary btn-block" type="submit" id="auth-submit">登 录</button>
          </form>
          <div class="demo-hint">演示账号可直接登录：<br /><code>demo@qiuzhao.dev</code> / <code>demo1234</code></div>
        </div>
      </div>`;
    let mode = 'login';
    const fields = document.getElementById('auth-fields');
    document.getElementById('tab-login').addEventListener('click', () => {
      mode = 'login'; document.getElementById('tab-login').classList.add('on'); document.getElementById('tab-reg').classList.remove('on');
      fields.innerHTML = '<div class="field"><label>邮箱</label><input id="a-email" type="email" placeholder="you@example.com" /></div><div class="field"><label>密码</label><input id="a-pwd" type="password" placeholder="至少 6 位" /></div>';
      document.getElementById('auth-submit').textContent = '登 录';
    });
    document.getElementById('tab-reg').addEventListener('click', () => {
      mode = 'register'; document.getElementById('tab-reg').classList.add('on'); document.getElementById('tab-login').classList.remove('on');
      fields.innerHTML = `
        <div class="field"><label>昵称（可选）</label><input id="a-name" placeholder="怎么称呼你" /></div>
        <div class="field"><label>邮箱</label><input id="a-email" type="email" placeholder="you@example.com" /></div>
        <div class="field"><label>密码</label><input id="a-pwd" type="password" placeholder="至少 6 位" /></div>`;
      document.getElementById('auth-submit').textContent = '注册并登录';
    });
    document.getElementById('auth-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = document.getElementById('a-email').value.trim();
      const pwd = document.getElementById('a-pwd').value;
      const name = (document.getElementById('a-name') || {}).value || '';
      if (!email || !pwd) return toast('请填写邮箱和密码', 'err');
      const btn = document.getElementById('auth-submit');
      btn.disabled = true; btn.textContent = '请稍候…';
      try {
        const data = mode === 'login'
          ? await API.post('/auth/login', { email, password: pwd })
          : await API.post('/auth/register', { email, password: pwd, name });
        API.setAuth(data.token, data.user);
        toast('欢迎回来，' + (data.user.name || '') + ' 🎯', 'ok');
        route();
      } catch (err) { toast(err.message, 'err'); }
      btn.disabled = false; btn.textContent = mode === 'login' ? '登 录' : '注册并登录';
    });
  }

  /* ---------- 应用外壳 ---------- */
  function renderShell(pageId) {
    const page = PAGES[pageId] || PAGES['dashboard'];
    const navHtml = NAV.map((n) => `<button class="nav-item ${n.id === pageId ? 'on' : ''}" data-nav="${n.id}"><span class="nav-ico">${n.ico}</span>${n.label}</button>`).join('');
    const chip = aiEnabled === true
      ? '<span class="ai-chip on"><span class="dot"></span>真实 AI 已接入</span>'
      : '<span class="ai-chip off"><span class="dot"></span>内置演示引擎</span>';
    app.innerHTML = `
      <div class="shell">
        <aside class="sidebar" id="sidebar">
          <div class="side-logo">
            <div class="logo-badge">战</div>
            <div><div class="logo-name">秋招作战台</div><div class="logo-ver">v2 · 2027 校招</div></div>
          </div>
          <nav class="side-nav">${navHtml}</nav>
          <div class="side-foot">
            <div class="side-user">
              <div class="avatar">${avatarName(API.user && API.user.name)}</div>
              <div><div class="u-name">${esc(API.user && API.user.name)}</div><div class="u-mail">${esc(API.user && API.user.email)}</div></div>
            </div>
            <button class="logout-btn" id="logout-btn">退出登录</button>
          </div>
        </aside>
        <div class="scrim" id="scrim"></div>
        <div class="main">
          <header class="topbar">
            <button class="menu-btn" id="menu-btn">☰</button>
            <div><h1>${page.title}</h1></div>
            <div class="page-desc">${page.desc}</div>
            <div class="topbar-right">${chip}</div>
          </header>
          <div class="content" id="page-root"></div>
        </div>
      </div>`;
    document.querySelectorAll('[data-nav]').forEach((b) => b.addEventListener('click', () => { location.hash = '#/' + b.dataset.nav; closeSidebar(); }));
    document.getElementById('menu-btn').addEventListener('click', toggleSidebar);
    document.getElementById('scrim').addEventListener('click', closeSidebar);
    document.getElementById('logout-btn').addEventListener('click', () => {
      API.logout(); toast('已退出登录'); route();
    });
  }

  function toggleSidebar() {
    const sb = document.getElementById('sidebar');
    sb.classList.toggle('open');
    document.getElementById('scrim').style.display = sb.classList.contains('open') ? 'block' : 'none';
  }
  function closeSidebar() {
    const sb = document.getElementById('sidebar');
    if (sb) { sb.classList.remove('open'); document.getElementById('scrim').style.display = 'none'; }
  }

  /* ---------- 路由 ---------- */
  async function route() {
    if (!API.isAuthed()) { renderAuth(); current = null; return; }
    let pageId = location.hash.replace(/^#\//, '').split('?')[0] || 'dashboard';
    if (!PAGES[pageId]) pageId = 'dashboard';
    renderShell(pageId);
    const root = document.getElementById('page-root');
    const mod = PAGES[pageId].mod;
    try {
      if (aiEnabled === null) {
        try { const d = await API.get('/dashboard'); aiEnabled = !!d.ai_enabled; } catch { aiEnabled = false; }
        const chip = document.querySelector('.ai-chip');
        if (chip) {
          chip.className = 'ai-chip ' + (aiEnabled ? 'on' : 'off');
          chip.innerHTML = aiEnabled ? '<span class="dot"></span>真实 AI 已接入' : '<span class="dot"></span>内置演示引擎';
          chip.title = aiEnabled ? '已配置 AI_API_KEY，调用真实大模型' : '未配置 AI_API_KEY，使用内置演示引擎';
        }
      }
      current = mod;
      if (typeof mod.render === 'function') {
        root.innerHTML = `<div class="loading-box">${spinner()}</div>`;
        root.innerHTML = await mod.render(root);
      }
      if (typeof mod.init === 'function') await mod.init(root);
    } catch (e) {
      console.error(e);
      root.innerHTML = `<div class="empty"><div class="ico">⚠️</div><div>页面加载失败：${esc(e.message)}</div></div>`;
    }
  }

  window.addEventListener('hashchange', () => { closeSidebar(); route(); });
  window.App = {
    route, toast, esc, todayStr, daysLeft, deadlineChip, fmtSalary, fmtDate, statusPill,
    openModal, closeModal, confirmDialog, fileToBase64, readFileText, imageToDataUrl, bindDropzone, spinner, emptyBox,
  };
  route();
})();
