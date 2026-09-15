'use strict';
/**
 * 模块 1：岗位雷达
 */
const Radar = {
  state: { page: 1, total: 0, facets: null, items: [], filter: {} },

  async render() {
    const { esc, deadlineChip, fmtSalary, statusPill } = window.App;
    this.state.facets = this.state.facets || (await API.get('/jobs/facets'));
    await this.load();
    const f = this.state.facets;
    const sel = (name, items, placeholder, allLabel = '全部') => `
      <select data-filter="${name}">
        <option value="">${allLabel}</option>
        ${(items || []).map((x) => `<option value="${esc(x.v)}" ${this.state.filter[name] === x.v ? 'selected' : ''}>${esc(x.v)} (${x.c})</option>`).join('')}
      </select>`;
    const list = this.state.items.map((j) => `
      <div class="job-card" data-id="${j.id}">
        <div class="jc-head">
          <div>
            <div class="jc-company">${esc(j.company)}</div>
            <div class="jc-position">${esc(j.position)}</div>
          </div>
          <span class="pill ${j.company_type === '央企国企' ? 'pill-navy' : j.company_type === '外企' ? 'pill-sky' : 'pill-gray'}">${esc(j.company_type || '')}</span>
        </div>
        <div class="jc-meta">
          <span>📍 ${esc(j.location || '')}</span>
          <span>🎓 ${esc(j.education_required || '')}</span>
          <span>💰 ${fmtSalary(j)}</span>
          <span>${j.has_written_test ? '📝 有笔试' : ''}</span>
          <span>${esc(j.batch || '')}</span>
        </div>
        <div class="jc-meta small muted">
          <span>${esc(j.industry || '')}</span><span>${esc(j.job_category || '')}</span><span>${esc(j.session_year || '')} 届</span>
          <span>${esc(j.major_requirement || '')}</span>
        </div>
        <div class="between">
          ${deadlineChip(j.deadline)}
          <div class="jc-actions">
            ${j.in_plan ? statusPill('planned') : `<button class="btn btn-primary btn-sm" data-add="${j.id}">＋ 加入投递</button>`}
            <button class="btn btn-sm" data-detail="${j.id}">详情</button>
          </div>
        </div>
      </div>`).join('');

    return `
      <div class="stack">
        <div class="card card-pad">
          <div class="between wrap">
            <div class="filter-bar">
              ${sel('company_type', f.company_type, '企业性质')}
              ${sel('industry', f.industry, '行业')}
              ${sel('job_category', f.job_category, '岗位大类')}
              ${sel('location', f.location, '地点')}
              ${sel('education', f.education, '学历')}
              ${sel('batch', f.batch, '批次')}
              <input type="text" placeholder="搜索公司 / 岗位 / 专业" value="${esc(this.state.filter.keyword || '')}" data-filter="keyword" style="min-width:170px" />
            </div>
            <div class="row">
              <button class="btn btn-sm" id="sync-btn">↻ 立即同步</button>
              <span class="small muted" id="sync-info">共 ${this.state.total} 个岗位</span>
            </div>
          </div>
        </div>

        <div class="grid g-3" id="job-grid">${list || window.App.emptyBox('没有符合筛选条件的岗位', '📡')}</div>

        <div class="between">
          <button class="btn btn-sm" id="prev-page" ${this.state.page <= 1 ? 'disabled' : ''}>上一页</button>
          <span class="small muted">第 ${this.state.page} 页 / 共 ${Math.max(1, Math.ceil(this.state.total / 24))} 页</span>
          <button class="btn btn-sm" id="next-page" ${this.state.page * 24 >= this.state.total ? 'disabled' : ''}>下一页</button>
        </div>
      </div>`;
  },

  async load() {
    const q = new URLSearchParams({ page: this.state.page, page_size: 24 });
    Object.entries(this.state.filter).forEach(([k, v]) => { if (v) q.set(k, v); });
    const d = await API.get('/jobs?' + q.toString());
    this.state.total = d.total;
    this.state.items = d.items;
  },

  async init(root) {
    const { toast, esc, fmtSalary, statusPill, openModal, closeModal } = window.App;

    root.querySelectorAll('[data-filter]').forEach((el) => {
      el.addEventListener('change', () => {
        this.state.filter[el.dataset.filter] = el.value || '';
        this.state.page = 1;
        this.refresh(root);
      });
      if (el.dataset.filter === 'keyword') {
        let timer = null;
        el.addEventListener('input', () => {
          clearTimeout(timer);
          timer = setTimeout(() => { this.state.filter.keyword = el.value; this.state.page = 1; this.refresh(root); }, 400);
        });
      }
    });

    root.querySelector('#prev-page').addEventListener('click', () => { this.state.page--; this.refresh(root); });
    root.querySelector('#next-page').addEventListener('click', () => { this.state.page++; this.refresh(root); });

    root.querySelector('#sync-btn').addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true; btn.textContent = '同步中…';
      try {
        const r = await API.post('/jobs/sync', {});
        toast(`同步完成：新增 ${r.added}，刷新 ${r.updated}，共 ${r.total} 条`, 'ok');
        await this.refresh(root);
      } catch (err) { toast(err.message, 'err'); }
      btn.disabled = false; btn.textContent = '↻ 立即同步';
    });

    root.querySelectorAll('[data-add]').forEach((b) => b.addEventListener('click', async (e) => {
      e.stopPropagation();
      try {
        await API.post('/applications', { job_id: Number(b.dataset.add) });
        toast('已加入今日作战日历 🎯', 'ok');
        await this.refresh(root);
      } catch (err) { toast(err.message, 'err'); }
    }));

    root.querySelectorAll('[data-detail]').forEach((b) => b.addEventListener('click', async () => {
      const j = await API.get('/jobs/' + b.dataset.detail);
      const mask = openModal(`
        <div class="modal-head"><h3>${esc(j.company)} · ${esc(j.position)}</h3><button class="modal-close" data-close>×</button></div>
        <div class="modal-body">
          <div class="row wrap" style="gap:8px">
            ${['company_type', 'industry', 'job_category', 'location', 'education_required', 'session_year', 'batch'].map((k) => j[k] ? `<span class="tag">${esc(j[k])}</span>` : '').join('')}
          </div>
          <div class="mt12 small muted">薪资：<b class="muted" style="color:var(--ink)">${fmtSalary(j)}</b> · 专业要求：${esc(j.major_requirement || '不限')}</div>
          <div class="mt8">${window.App.deadlineChip(j.deadline)}</div>
          ${j.has_written_test ? '<div class="mt8 pill pill-amber">📝 该岗位包含笔试环节</div>' : ''}
          <div class="mt8 small muted">数据源：${esc(j.source || '')} · 同步于 ${esc(String(j.synced_at || '').slice(0, 16))}</div>
        </div>
        <div class="modal-foot">
          ${j.in_plan ? `<span class="pill pill-blue">已在投递计划</span>` : `<button class="btn btn-primary" id="detail-add">＋ 加入投递计划</button>`}
          <button class="btn" data-close>关闭</button>
        </div>`);
      mask.querySelector('[data-close]').addEventListener('click', () => closeModal(mask));
      const addBtn = mask.querySelector('#detail-add');
      if (addBtn) addBtn.addEventListener('click', async () => {
        try {
          await API.post('/applications', { job_id: j.id });
          toast('已加入今日作战日历 🎯', 'ok');
          closeModal(mask);
          await this.refresh(root);
        } catch (err) { toast(err.message, 'err'); }
      });
    }));
  },

  async refresh(root) {
    // 重建整页，保持筛选状态（render 会读取 this.state）
    const pageRoot = document.getElementById('page-root');
    pageRoot.innerHTML = '<div class="loading-box"><div class="spinner"></div></div>';
    const html = await this.render();
    pageRoot.innerHTML = html;
    await this.init(pageRoot);
  },
};
