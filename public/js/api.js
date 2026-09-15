'use strict';
/**
 * API 客户端：统一鉴权、错误处理、JSON 解析
 */
const API = (() => {
  let token = localStorage.getItem('qz_token') || '';
  let user = null;
  try { user = JSON.parse(localStorage.getItem('qz_user') || 'null'); } catch { user = null; }

  async function req(method, path, body) {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = 'Bearer ' + token;
    const resp = await fetch('/api' + path, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    let data = null;
    try { data = await resp.json(); } catch { /* 非 JSON 响应 */ }
    if (resp.status === 401 && !path.startsWith('/auth/')) {
      logout();
      location.hash = '#/login';
      throw new Error('登录已过期，请重新登录');
    }
    if (!resp.ok) {
      const msg = (data && data.error) || `请求失败 (${resp.status})`;
      const err = new Error(msg);
      err.status = resp.status;
      throw err;
    }
    return data;
  }

  function logout() {
    token = '';
    user = null;
    localStorage.removeItem('qz_token');
    localStorage.removeItem('qz_user');
  }

  function setAuth(t, u) {
    token = t;
    user = u;
    localStorage.setItem('qz_token', t);
    localStorage.setItem('qz_user', JSON.stringify(u));
  }

  return {
    get token() { return token; },
    get user() { return user; },
    setAuth,
    logout,
    isAuthed: () => Boolean(token),
    get: (p) => req('GET', p),
    post: (p, b) => req('POST', p, b),
    put: (p, b) => req('PUT', p, b),
    patch: (p, b) => req('PATCH', p, b),
    del: (p) => req('DELETE', p),
  };
})();
