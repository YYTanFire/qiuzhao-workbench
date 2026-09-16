'use strict';
/**
 * 模块 1：岗位雷达 —— 飞书式多条件组合筛选
 * 学习飞书多维表格筛选交互：任意添加筛选条件（字段 × 运算符 × 值），
 * 支持"满足全部 / 任一条件"逻辑切换、包含/不包含/包含任意/包含全部/为空/不为空等关系。
 */
const Radar = {
  state: { page: 1, total: 0, facets: null, items: [], filter: { logic: 'and', conditions: [], keyword: '' } },

  // ---- 飞书式筛选：字段 / 运算符元数据 ----
  FIELD_META: {
    company_type: { label: '公司性质', type: 'enum' },
    industry: { label: '行业', type: 'enum' },
    job_category: { label: '岗位大类', type: 'enum' },
    location: { label: '地点', type: 'enum' },
    education_required: { label: '学历', type: 'enum' },
    batch: { label: '批次', type: 'enum' },
    company: { label: '公司名称', type: 'text' },
    position: { label: '岗位名称', type: 'text' },
    major_requirement: { label: '专业要求', type: 'text' },
  },
  OP_META: {
    in: '包含任意', all: '包含全部', eq: '等于', neq: '不等于',
    contains: '包含', not_contains: '不包含', empty: '为空', not_empty: '不为空',
  },
  opsFor(type) {
    if (type === 'text') return ['contains', 'not_contains', 'empty', 'not_empty'];
    return ['in', 'all', 'eq', 'neq', 'empty', 'not_empty'];
  },
  isValueNeeded(op) { return !['empty', 'not_empty'].includes(op); },

  async render() {
    const { esc, deadlineChip, fmtSalary, statusPill } = window.App;
    this.state.facets = this.state.facets || (await API.get('/jobs/facets'));
    await this.load();
    const f = this.state.facets;
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
          ${deadlineChip(j)}
          <div class="jc-actions">
            ${j.in_plan ? statusPill('planned') : `<button class="btn btn-primary btn-sm" data-add="${j.id}">＋ 加入投递</button>`}
            <button class="btn btn-sm" data-detail="${j.id}">详情</button>
          </div>
        </div>
      </div>`).join('');

    return `
      <div class="stack">
        <div class="card card-pad" id="filter-panel">
          <div class="between wrap">
            <div class="filter-bar">
              <input type="text" placeholder="🔍 搜索公司 / 岗位 / 专业" value="${esc(this.state.filter.keyword || '')}" data-filter="keyword" style="min-width:180px" />
              <select data-filter="logic" title="多个条件的组合方式">
                <option value="and" ${this.state.filter.logic !== 'or' ? 'selected' : ''}>满足全部条件</option>
                <option value="or" ${this.state.filter.logic === 'or' ? 'selected' : ''}>满足任一条件</option>
              </select>
              <button class="btn btn-sm" id="add-cond">＋ 添加筛选条件</button>
            </div>
            <div class="row">
              <button class="btn btn-sm" id="sync-btn">↻ 立即同步</button>
              <span class="small muted" id="sync-info">共 ${this.state.total} 个岗位</span>
            </div>
          </div>
          <div class="filter-conds" id="filter-conds">
            ${this.condsHtml(f)}
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

  // 条件列表 HTML（仿飞书：字段 ▾ 运算符 ▾ 值 [多选浮层/文本] ✕）
  condsHtml(f) {
    const { esc } = window.App;
    const conds = this.state.filter.conditions || [];
    const rows = conds.map((c, i) => {
      const meta = this.FIELD_META[c.f] || this.FIELD_META.company_type;
      const ops = this.opsFor(meta.type);
      const needVal = this.isValueNeeded(c.op);
      const facetVals = (c.f && f[c.f]) ? f[c.f].map((x) => x.v) : [];
      const selVals = Array.isArray(c.v) ? c.v.filter((v) => facetVals.includes(v)) : [];
      const chips = selVals.map((v) => `<span class="f-chip" data-v="${esc(v)}">${esc(v)}<i data-rm="${esc(v)}">×</i></span>`).join('');
      const valueHtml = needVal
        ? (meta.type === 'text'
          ? `<input class="f-text" type="text" data-ci="${i}" placeholder="支持逗号分隔多个值" value="${esc((Array.isArray(c.v) ? c.v : []).join(', '))}" />`
          : `<div class="f-ms" data-ci="${i}">
               <button class="f-ms-btn" type="button" data-ci="${i}">${chips || '<span class="muted">选择值… ▾</span>'}</button>
               <div class="f-ms-pop" hidden data-ci="${i}">
                 ${facetVals.map((v) => `<label class="f-ms-opt"><input type="checkbox" data-ci="${i}" value="${esc(v)}" ${selVals.includes(v) ? 'checked' : ''}><span>${esc(v)}</span></label>`).join('') || '<div class="small muted" style="padding:6px 10px">暂无可选值</div>'}
               </div>
             </div>`)
        : '<span class="small muted" style="padding:0 4px">—</span>';
      return `
        <div class="filter-cond" data-ci="${i}">
          <select class="f-field" data-ci="${i}">
            ${Object.entries(this.FIELD_META).map(([k, m]) => `<option value="${k}" ${c.f === k ? 'selected' : ''}>${m.label}</option>`).join('')}
          </select>
          <select class="f-op" data-ci="${i}">
            ${ops.map((op) => `<option value="${op}" ${c.op === op ? 'selected' : ''}>${this.OP_META[op]}</option>`).join('')}
          </select>
          ${valueHtml}
          <button class="f-del" type="button" data-ci="${i}" title="删除条件">✕</button>
        </div>`;
    }).join('');
    return rows || '<div class="small muted">未设置筛选条件，展示全部岗位。点击「＋ 添加筛选条件」开始组合筛选。</div>';
  },

  async load() {
    const q = new URLSearchParams({ page: this.state.page, page_size: 24 });
    const conds = (this.state.filter.conditions || []).filter((c) => {
      if (!c.f || !c.op) return false;
      if (!this.isValueNeeded(c.op)) return true;
      const v = Array.isArray(c.v) ? c.v : String(c.v || '').split(/[,，、]/).map((s) => s.trim()).filter(Boolean);
      return v.length > 0;
    });
    if (conds.length) {
      q.set('logic', this.state.filter.logic === 'or' ? 'or' : 'and');
      q.set('filters', JSON.stringify(conds.map((c) => ({
        f: c.f, op: c.op,
        v: Array.isArray(c.v) ? c.v : String(c.v || '').split(/[,，、]/).map((s) => s.trim()).filter(Boolean),
      }))));
    }
    if (this.state.filter.keyword) q.set('keyword', this.state.filter.keyword);
    const d = await API.get('/jobs?' + q.toString());
    this.state.total = d.total;
    this.state.items = d.items;
  },

  async init(root) {
    const { toast, esc, fmtSalary, statusPill, openModal, closeModal } = window.App;

    // —— 关键词 / 逻辑切换 ——
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

    this.bindConds(root);

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
          <div class="mt8">${window.App.deadlineChip(j)}</div>
          ${j.has_written_test ? '<div class="mt8 pill pill-amber">📝 该岗位包含笔试环节</div>' : ''}
          ${j.apply_url ? `<div class="mt8"><a class="btn btn-sm btn-primary" href="${esc(j.apply_url)}" target="_blank" rel="noopener">🚀 前往投递</a></div>` : ''}
          ${j.official_url ? `<div class="mt8 small"><a href="${esc(j.official_url)}" target="_blank" rel="noopener" style="color:var(--primary)">📄 查看官方公告 →</a></div>` : ''}
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

  // 绑定条件区交互：添加/删除条件、字段/运算符切换、多选浮层、文本输入
  bindConds(root) {
    const f = this.state.facets;
    const addBtn = root.querySelector('#add-cond');
    if (addBtn) addBtn.addEventListener('click', () => {
      this.state.filter.conditions.push({ f: 'company_type', op: 'in', v: [] });
      this.state.page = 1;
      this.renderFilterPanel(root);
    });

    root.querySelector('#filter-conds').addEventListener('change', (e) => {
      const el = e.target;
      const ci = Number(el.dataset.ci);
      const cond = this.state.filter.conditions[ci];
      if (!cond) return;
      const isCheckbox = el.type === 'checkbox';
      if (el.classList.contains('f-field')) {
        const meta = this.FIELD_META[el.value];
        cond.f = el.value;
        cond.op = this.opsFor(meta.type)[0];
        cond.v = [];
      } else if (el.classList.contains('f-op')) {
        cond.op = el.value;
        if (!this.isValueNeeded(el.value)) cond.v = [];
      } else if (el.classList.contains('f-text')) {
        cond.v = el.value.split(/[,，、]/).map((s) => s.trim()).filter(Boolean);
      } else if (isCheckbox) {
        const vals = cond.v || [];
        cond.v = el.checked ? Array.from(new Set([...vals, el.value])) : vals.filter((v) => v !== el.value);
      }
      this.state.page = 1;
      // 勾选多选值：只刷新列表（保持浮层打开，支持连续勾选）；字段/运算符/文本变化：重建面板
      if (isCheckbox) {
        // 同步更新该条件按钮上的已选 chips（浮层保持打开）
        const { esc } = window.App;
        const msBtn = root.querySelector(`.f-ms-btn[data-ci="${ci}"]`);
        if (msBtn) {
          const facetVals = (cond.f && this.state.facets[cond.f]) ? this.state.facets[cond.f].map((x) => x.v) : [];
          const selVals = (cond.v || []).filter((v) => facetVals.includes(v));
          msBtn.innerHTML = selVals.map((v) => `<span class="f-chip" data-v="${esc(v)}">${esc(v)}<i data-rm="${esc(v)}">×</i></span>`).join('') || '<span class="muted">选择值… ▾</span>';
        }
        this.refreshList(root);
      } else {
        this.renderFilterPanel(root);
      }
    });

    // 文本条件：input 即时生效（防抖），只刷新列表不重建面板，保持输入焦点
    root.querySelector('#filter-conds').addEventListener('input', (e) => {
      const el = e.target;
      if (!el.classList.contains('f-text')) return;
      const ci = Number(el.dataset.ci);
      const cond = this.state.filter.conditions[ci];
      if (!cond) return;
      clearTimeout(this._textTimer);
      this._textTimer = setTimeout(() => {
        cond.v = el.value.split(/[,，、]/).map((s) => s.trim()).filter(Boolean);
        this.state.page = 1;
        this.refreshList(root);
      }, 400);
    });

    root.querySelector('#filter-conds').addEventListener('click', (e) => {
      const btn = e.target.closest('.f-del');
      const msBtn = e.target.closest('.f-ms-btn');
      const rmChip = e.target.closest('[data-rm]');
      if (btn) {
        const ci = Number(btn.dataset.ci);
        this.state.filter.conditions.splice(ci, 1);
        this.state.page = 1;
        this.renderFilterPanel(root);
      } else if (msBtn) {
        e.stopPropagation();
        const ci = Number(msBtn.dataset.ci);
        const pop = root.querySelector(`.f-ms-pop[data-ci="${ci}"]`);
        if (pop) pop.hidden = !pop.hidden;
      } else if (rmChip) {
        const ci = Number(rmChip.closest('.f-ms').dataset.ci);
        const cond = this.state.filter.conditions[ci];
        cond.v = (cond.v || []).filter((v) => v !== rmChip.dataset.rm);
        this.state.page = 1;
        this.renderFilterPanel(root);
      }
    });

    // 点击浮层外关闭
    document.addEventListener('click', (e) => {
      if (!e.target.closest('.f-ms')) {
        root.querySelectorAll('.f-ms-pop').forEach((p) => { p.hidden = true; });
      }
    });
  },

  // 只重建筛选面板并刷新列表（避免输入框失焦、保持滚动）
  async renderFilterPanel(root) {
    const panel = root.querySelector('#filter-panel');
    panel.innerHTML = `
      <div class="between wrap">
        <div class="filter-bar">
          <input type="text" placeholder="🔍 搜索公司 / 岗位 / 专业" value="${window.App.esc(this.state.filter.keyword || '')}" data-filter="keyword" style="min-width:180px" />
          <select data-filter="logic" title="多个条件的组合方式">
            <option value="and" ${this.state.filter.logic !== 'or' ? 'selected' : ''}>满足全部条件</option>
            <option value="or" ${this.state.filter.logic === 'or' ? 'selected' : ''}>满足任一条件</option>
          </select>
          <button class="btn btn-sm" id="add-cond">＋ 添加筛选条件</button>
        </div>
        <div class="row">
          <button class="btn btn-sm" id="sync-btn">↻ 立即同步</button>
          <span class="small muted" id="sync-info">共 ${this.state.total} 个岗位</span>
        </div>
      </div>
      <div class="filter-conds" id="filter-conds">${this.condsHtml(this.state.facets)}</div>`;
    // 重新绑定：关键词/逻辑、条件交互
    panel.querySelectorAll('[data-filter]').forEach((el) => {
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
    this.bindConds(root);
    // 刷新列表（保留计数与分页）
    await this.refreshList(root);
  },

  // 只刷新岗位列表区（保持筛选面板与浮层状态不变）
  async refreshList(root) {
    await this.load();
    const { emptyBox } = window.App;
    const grid = root.querySelector('#job-grid');
    const info = root.querySelector('#sync-info');
    if (grid) grid.innerHTML = this.state.items.map((j) => this.cardHtml(j)).join('') || emptyBox('没有符合筛选条件的岗位', '📡');
    if (info) info.textContent = `共 ${this.state.total} 个岗位`;
    const prev = root.querySelector('#prev-page');
    const next = root.querySelector('#next-page');
    if (prev) prev.disabled = this.state.page <= 1;
    if (next) next.disabled = this.state.page * 24 >= this.state.total;
    // 重新绑定列表操作（加入投递 / 详情）
    this.bindList(root);
  },

  cardHtml(j) {
    const { esc, deadlineChip, fmtSalary, statusPill } = window.App;
    return `
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
          ${deadlineChip(j)}
          <div class="jc-actions">
            ${j.in_plan ? statusPill('planned') : `<button class="btn btn-primary btn-sm" data-add="${j.id}">＋ 加入投递</button>`}
            <button class="btn btn-sm" data-detail="${j.id}">详情</button>
          </div>
        </div>
      </div>`;
  },

  bindList(root) {
    const { toast } = window.App;
    root.querySelectorAll('[data-add]').forEach((b) => b.addEventListener('click', async (e) => {
      e.stopPropagation();
      try {
        await API.post('/applications', { job_id: Number(b.dataset.add) });
        toast('已加入今日作战日历 🎯', 'ok');
        await this.renderFilterPanel(root);
      } catch (err) { toast(err.message, 'err'); }
    }));
    root.querySelectorAll('[data-detail]').forEach((b) => b.addEventListener('click', async () => {
      const { esc, fmtSalary, openModal, closeModal, deadlineChip, statusPill } = window.App;
      const j = await API.get('/jobs/' + b.dataset.detail);
      const mask = openModal(`
        <div class="modal-head"><h3>${esc(j.company)} · ${esc(j.position)}</h3><button class="modal-close" data-close>×</button></div>
        <div class="modal-body">
          <div class="row wrap" style="gap:8px">
            ${['company_type', 'industry', 'job_category', 'location', 'education_required', 'session_year', 'batch'].map((k) => j[k] ? `<span class="tag">${esc(j[k])}</span>` : '').join('')}
          </div>
          <div class="mt12 small muted">薪资：<b class="muted" style="color:var(--ink)">${fmtSalary(j)}</b> · 专业要求：${esc(j.major_requirement || '不限')}</div>
          <div class="mt8">${deadlineChip(j)}</div>
          ${j.has_written_test ? '<div class="mt8 pill pill-amber">📝 该岗位包含笔试环节</div>' : ''}
          ${j.apply_url ? `<div class="mt8"><a class="btn btn-sm btn-primary" href="${esc(j.apply_url)}" target="_blank" rel="noopener">🚀 前往投递</a></div>` : ''}
          ${j.official_url ? `<div class="mt8 small"><a href="${esc(j.official_url)}" target="_blank" rel="noopener" style="color:var(--primary)">📄 查看官方公告 →</a></div>` : ''}
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
          await this.renderFilterPanel(root);
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
