'use strict';
/**
 * 模块 2：今日作战日历 —— 投递计划时间轴 + 飞书式多条件筛选 + 多维分析可视化
 */
const Calendar = {
  state: { status: 'all', filter: { logic: 'and', conditions: [], keyword: '' } },
  _facets: null, // 全量投递计划枚举缓存（避免筛选后漂移）

  FIELD_META: {
    company_type: { label: '公司性质', type: 'enum' },
    industry: { label: '行业', type: 'enum' },
    job_track: { label: '岗位方向', type: 'enum' },
    location: { label: '地点', type: 'enum' },
    education_required: { label: '学历', type: 'enum' },
    batch: { label: '批次', type: 'enum' },
    company: { label: '公司名称', type: 'text' },
    position: { label: '岗位名称', type: 'text' },
    major_requirement: { label: '专业要求', type: 'text' },
    english_req: { label: '英语要求', type: 'text' },
    cert_req: { label: '证书要求', type: 'text' },
    skill_req: { label: '技能要求', type: 'text' },
  },
  OP_META: {
    in: '包含任意', all: '包含全部', eq: '等于', neq: '不等于',
    contains: '包含', not_contains: '不包含', empty: '为空', not_empty: '不为空',
  },
  opsFor(type) { return type === 'text' ? ['contains', 'not_contains', 'empty', 'not_empty'] : ['in', 'all', 'eq', 'neq', 'empty', 'not_empty']; },
  isValueNeeded(op) { return !['empty', 'not_empty'].includes(op); },

  buildQuery() {
    const q = new URLSearchParams();
    if (this.state.status !== 'all') q.set('status', this.state.status);
    const conds = (this.state.filter.conditions || []).filter((c) => {
      if (!c.f || !c.op) return false;
      if (!this.isValueNeeded(c.op)) return true;
      const v = Array.isArray(c.v) ? c.v : String(c.v || '').split(/[,，、]/).map((s) => s.trim()).filter(Boolean);
      return v.length > 0;
    });
    if (conds.length) {
      q.set('logic', this.state.filter.logic);
      q.set('filters', JSON.stringify(conds.map((c) => ({ f: c.f, op: c.op, v: Array.isArray(c.v) ? c.v : String(c.v || '').split(/[,，、]/).map((s) => s.trim()).filter(Boolean) }))));
    }
    return q.toString();
  },

  async render() {
    const { esc, daysLeft, statusPill } = window.App;
    const qs = this.buildQuery();
    const [items, settings, stats, overview] = await Promise.all([
      API.get('/calendar?' + qs),
      API.get('/calendar/settings'),
      API.get('/calendar/stats?' + qs),
      API.get('/calendar/stats/overview'),
    ]);
    this.state.items = items;
    this.state.stats = stats;
    // 全量 facets 缓存（首次拉取全部投递计划聚合）
    if (!this._facets) {
      const allItems = await API.get('/calendar');
      const facet = (key) => { const m = new Map(); for (const a of allItems) { const v = a[key]; if (v && String(v).trim()) m.set(v, (m.get(v) || 0) + 1); } return Array.from(m.entries()).map(([v, c]) => ({ v, c })).sort((x, y) => y.c - x.c); };
      this._facets = { company_type: facet('company_type'), industry: facet('industry'), job_track: facet('job_track'), location: facet('location'), education_required: facet('education_required'), batch: facet('batch') };
    }
    const today = new Date(); today.setHours(0, 0, 0, 0);

    const timeline = items.map((a) => {
      const d = a.days_left;
      const dateTxt = a.deadline ? `${a.deadline.slice(5, 7)}.${a.deadline.slice(8, 10)}` : '--';
      const dayLabel = a.deadline ? (d == null ? '未知' : d < 0 ? `超 ${-d} 天` : d === 0 ? '今天' : `剩 ${d} 天`) : (a.deadline_text || '未知');
      const cls = d != null && d < 0 ? 'expired' : a.alert_level === 'urgent' ? 'urgent' : a.alert_level === 'warn' ? 'warn' : '';
      const done = ['offer', 'rejected'].includes(a.status);
      return `
      <div class="cal-item ${cls} ${done ? 'done' : ''}">
        <div class="cal-card ${a.alert_level === 'urgent' ? 'urgent' : a.alert_level === 'warn' ? 'warn' : ''}">
          <div class="cal-days"><b>${a.deadline ? dateTxt.split('.')[1] : '—'}</b><span>${a.deadline ? dateTxt.split('.')[0] + '月' : (a.deadline_text || '截止')}</span></div>
          <div class="cal-main">
            <div class="row" style="gap:8px"><span class="co">${esc(a.company)}</span>${statusPill(a.status)}${a.alert_level === 'urgent' ? '<span class="pill pill-red">紧急</span>' : a.alert_level === 'warn' ? '<span class="pill pill-amber">预警</span>' : ''}</div>
            <div class="po">${esc(a.position)}</div>
            <div class="lo">${esc(a.location || '')}${a.salary_min ? ' · ' + (a.salary_min) + '–' + (a.salary_max || a.salary_min) + 'K' : ''} · ${esc(a.education_required || '')} · ${esc(a.job_track || '')}</div>
            <div class="small muted mt8">
              ${a.english_req ? `🆎 英语：${esc(a.english_req)}　` : ''}${a.cert_req ? `📜 证书：${esc(a.cert_req)}　` : ''}${a.skill_req ? `🛠 技能：${esc(a.skill_req)}` : ''}
              ${a.major_requirement ? `<div>🎓 专业：${esc(a.major_requirement)}</div>` : ''}
            </div>
            ${a.note ? `<div class="small muted mt8">📌 ${esc(a.note)}</div>` : ''}
          </div>
          <div style="text-align:right;display:flex;flex-direction:column;gap:8px;align-items:flex-end">
            <span class="deadline-chip ${d != null && d <= 3 ? 'dl-urgent' : d != null && d <= 7 ? 'dl-warn' : 'dl-normal'}">${dayLabel}</span>
            <select class="status-select" data-status="${a.application_id}">
              ${['planned', 'applied', 'written_test', 'interview', 'offer', 'rejected'].map((s) => `<option value="${s}" ${a.status === s ? 'selected' : ''}>${({ planned: '待投递', applied: '已投递', written_test: '笔试中', interview: '面试中', offer: '已拿 Offer', rejected: '已淘汰' })[s]}</option>`).join('')}
            </select>
            <div class="row" style="gap:6px">
              <button class="btn btn-sm btn-ghost" data-note="${a.application_id}" title="备注">✎</button>
              <button class="btn btn-sm btn-danger" data-del="${a.application_id}">移除</button>
            </div>
          </div>
        </div>
      </div>`;
    }).join('') || window.App.emptyBox('没有符合筛选条件的投递项', '🗓');

    const statCards = [
      ['计划总数', overview.total, ''],
      ['今日截止', overview.due_today, overview.due_today ? 'danger' : ''],
      ['7 天内', overview.due_week, ''],
      ['紧急(≤' + settings.urgent_days + '天)', overview.urgent, 'urgent'],
      ['预警(≤' + settings.warn_days + '天)', overview.warn, 'warn'],
    ];

    return `
      <div class="stack">
        <div class="stat-grid" style="grid-template-columns:repeat(5,1fr)">
          ${statCards.map(([l, v, cls]) => `<div class="stat-card ${cls === 'danger' ? 'red' : cls === 'urgent' ? 'red' : cls === 'warn' ? 'amber' : ''}"><div class="lbl">${l}</div><div class="num" style="${cls ? 'color:var(--urgent)' : ''}">${v}</div></div>`).join('')}
        </div>

        <div class="card card-pad">
          <div class="between wrap">
            <div>
              <div class="card-title">多维分析</div>
              <div class="card-sub">当前筛选 ${stats.total} 个岗位的分布画像 · 英语/证书/技能来自官方公告（持续抓取中）</div>
            </div>
          </div>
          <div class="grid g-2 mt16">
            <div class="chart-box"><div class="chart-title">行业分布</div><div class="chart" id="ch-industry"></div></div>
            <div class="chart-box"><div class="chart-title">岗位方向</div><div class="chart" id="ch-track"></div></div>
            <div class="chart-box"><div class="chart-title">学历要求</div><div class="chart" id="ch-edu"></div></div>
            <div class="chart-box"><div class="chart-title">地点分布</div><div class="chart" id="ch-loc"></div></div>
            <div class="chart-box"><div class="chart-title">英语要求</div><div class="chart" id="ch-english"></div></div>
            <div class="chart-box"><div class="chart-title">证书 / 技能要求</div><div class="chart" id="ch-cert"></div></div>
          </div>
        </div>

        <div class="card card-pad">
          <div class="between wrap">
            <div>
              <div class="card-title">投递作战时间轴</div>
              <div class="card-sub">按网申截止日期升序 · 橙=预警 红=紧急 绿=已结束 · 多条件组合筛选</div>
            </div>
            <div class="row wrap">
              <select class="status-select" id="status-filter" style="min-width:110px">
                <option value="all">全部状态</option>
                ${['planned', 'applied', 'written_test', 'interview', 'offer', 'rejected'].map((s) => `<option value="${s}" ${this.state.status === s ? 'selected' : ''}>${({ planned: '待投递', applied: '已投递', written_test: '笔试中', interview: '面试中', offer: '已拿 Offer', rejected: '已淘汰' })[s]}</option>`).join('')}
              </select>
              <button class="btn btn-sm" id="set-btn">⚙ 预警阈值</button>
            </div>
          </div>
          <div class="filter-bar mt12">
            <select data-logic class="btn btn-sm" style="width:auto">
              <option value="and" ${this.state.filter.logic !== 'or' ? 'selected' : ''}>满足全部条件</option>
              <option value="or" ${this.state.filter.logic === 'or' ? 'selected' : ''}>满足任一条件</option>
            </select>
            <button class="btn btn-sm" id="add-cond">＋ 添加筛选条件</button>
            <button class="btn btn-sm btn-ghost" id="clear-cond">清空条件</button>
            <span class="small muted" id="cal-count">共 ${stats.total} 个岗位</span>
          </div>
          <div id="filter-conds" class="mt12">${this.condsHtml()}</div>
          <div class="cal-timeline mt16">${timeline}</div>
        </div>
      </div>`;
  },

  condsHtml() {
    const { esc } = window.App;
    const conds = this.state.filter.conditions || [];
    const rows = conds.map((c, i) => {
      const meta = this.FIELD_META[c.f] || this.FIELD_META.company_type;
      const ops = this.opsFor(meta.type);
      const needVal = this.isValueNeeded(c.op);
      const facetVals = (meta.type === 'enum' && this._facets[c.f]) ? this._facets[c.f].map((x) => x.v) : [];
      const selVals = Array.isArray(c.v) ? c.v.filter((v) => v != null && String(v).trim() !== '') : [];
      const chips = selVals.map((v) => `<span class="f-chip" data-v="${esc(v)}">${esc(v)}<i data-rm="${esc(v)}">×</i></span>`).join('');
      const valueHtml = needVal
        ? (meta.type === 'text'
          ? `<input class="f-text" type="text" data-ci="${i}" placeholder="支持逗号分隔多个值" value="${esc(selVals.join(', '))}" />`
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
    return rows || '<div class="small muted">未设置筛选条件，展示全部投递。点击「＋ 添加筛选条件」开始组合筛选。</div>';
  },

  async init(root) {
    const { toast, openModal, closeModal, confirmDialog, esc } = window.App;
    const refresh = async () => {
      const pageRoot = document.getElementById('page-root');
      pageRoot.innerHTML = '<div class="loading-box"><div class="spinner"></div></div>';
      const html = await this.render();
      pageRoot.innerHTML = html;
      await this.init(pageRoot);
    };

    root.querySelector('#status-filter').addEventListener('change', (e) => { this.state.status = e.target.value; refresh(); });
    root.querySelector('[data-logic]').addEventListener('change', (e) => { this.state.filter.logic = e.target.value; refresh(); });
    root.querySelector('#add-cond').addEventListener('click', () => {
      this.state.filter.conditions.push({ f: 'company_type', op: 'in', v: [] });
      this.renderPanel(root);
    });
    const clearBtn = root.querySelector('#clear-cond');
    if (clearBtn) clearBtn.addEventListener('click', () => { this.state.filter.conditions = []; refresh(); });

    this.bindConds(root);

    // 渲染图表
    this.renderCharts(root);

    root.querySelector('#set-btn').addEventListener('click', async () => {
      const s = await API.get('/calendar/settings');
      const mask = openModal(`
        <div class="modal-head"><h3>预警阈值设置</h3><button class="modal-close" data-close>×</button></div>
        <div class="modal-body">
          <div class="row" style="gap:16px">
            <div class="field" style="flex:1"><label>橙色预警（截止前 N 天）</label><input type="number" id="warn-days" min="1" max="30" value="${s.warn_days}" /></div>
            <div class="field" style="flex:1"><label>红色紧急（截止前 N 天）</label><input type="number" id="urgent-days" min="0" max="30" value="${s.urgent_days}" /></div>
          </div>
          <div class="small muted">示例：截止前 7 天标橙、前 3 天标红，帮助你优先处理最紧迫的投递。</div>
        </div>
        <div class="modal-foot"><button class="btn" data-close>取消</button><button class="btn btn-primary" id="save-set">保存</button></div>`);
      mask.querySelector('[data-close]').addEventListener('click', () => closeModal(mask));
      mask.querySelector('#save-set').addEventListener('click', async () => {
        try {
          await API.put('/calendar/settings', { warn_days: mask.querySelector('#warn-days').value, urgent_days: mask.querySelector('#urgent-days').value });
          toast('预警阈值已更新', 'ok');
          closeModal(mask);
          refresh();
        } catch (err) { toast(err.message, 'err'); }
      });
    });

    root.querySelectorAll('[data-status]').forEach((sel) => sel.addEventListener('change', async () => {
      try {
        await API.patch('/applications/' + sel.dataset.status, { status: sel.value });
        toast('状态已更新', 'ok');
      } catch (err) { toast(err.message, 'err'); }
    }));

    root.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', () => {
      confirmDialog('确定从投递计划中移除这条记录吗？（不会删除岗位本身）', async () => {
        try { await API.del('/applications/' + b.dataset.del); toast('已移除', 'ok'); refresh(); }
        catch (err) { toast(err.message, 'err'); }
      });
    }));

    root.querySelectorAll('[data-note]').forEach((b) => b.addEventListener('click', async () => {
      const mask = openModal(`
        <div class="modal-head"><h3>编辑备注</h3><button class="modal-close" data-close>×</button></div>
        <div class="modal-body"><div class="field"><label>备注</label><textarea id="note-text" placeholder="例如：笔试前刷 3 套行测 / 联系内推人"></textarea></div></div>
        <div class="modal-foot"><button class="btn" data-close>取消</button><button class="btn btn-primary" id="save-note">保存</button></div>`);
      mask.querySelector('[data-close]').addEventListener('click', () => closeModal(mask));
      mask.querySelector('#save-note').addEventListener('click', async () => {
        try {
          await API.patch('/applications/' + b.dataset.note, { note: mask.querySelector('#note-text').value });
          toast('备注已保存', 'ok');
          closeModal(mask);
          refresh();
        } catch (err) { toast(err.message, 'err'); }
      });
    }));
  },

  // 条件区交互：字段/运算符切换、多选浮层、文本输入、删除
  bindConds(root) {
    const { esc } = window.App;
    const refreshList = async () => {
      const pageRoot = document.getElementById('page-root');
      pageRoot.innerHTML = '<div class="loading-box"><div class="spinner"></div></div>';
      const html = await this.render();
      pageRoot.innerHTML = html;
      await this.init(pageRoot);
    };

    root.querySelector('#filter-conds').addEventListener('change', (e) => {
      const el = e.target;
      const ci = Number(el.dataset.ci);
      const cond = this.state.filter.conditions[ci];
      if (!cond) return;
      if (el.classList.contains('f-field')) {
        const meta = this.FIELD_META[el.value];
        cond.f = el.value; cond.op = this.opsFor(meta.type)[0]; cond.v = [];
        refreshList();
        return;
      } else if (el.classList.contains('f-op')) {
        cond.op = el.value;
        if (!this.isValueNeeded(el.value)) cond.v = [];
        refreshList();
        return;
      } else if (el.classList.contains('f-text')) {
        cond.v = el.value.split(/[,，、]/).map((s) => s.trim()).filter(Boolean);
        this.state.page = 1;
        this.debouncedRefresh(1200, refreshList);
      } else if (el.type === 'checkbox') {
        const vals = cond.v || [];
        cond.v = el.checked ? Array.from(new Set([...vals, el.value])) : vals.filter((v) => v !== el.value);
        const msBtn = root.querySelector(`.f-ms-btn[data-ci="${ci}"]`);
        if (msBtn) {
          const facetVals = (this._facets[cond.f] || []).map((x) => x.v);
          const selVals = (cond.v || []).filter((v) => facetVals.includes(v));
          msBtn.innerHTML = selVals.map((v) => `<span class="f-chip" data-v="${esc(v)}">${esc(v)}<i data-rm="${esc(v)}">×</i></span>`).join('') || '<span class="muted">选择值… ▾</span>';
        }
        this.debouncedRefresh(500, refreshList);
      }
    });

    root.querySelector('#filter-conds').addEventListener('input', (e) => {
      const el = e.target;
      if (!el.classList.contains('f-text')) return;
      const ci = Number(el.dataset.ci);
      const cond = this.state.filter.conditions[ci];
      if (!cond) return;
      clearTimeout(this._textTimer);
      this._textTimer = setTimeout(() => {
        cond.v = el.value.split(/[,，、]/).map((s) => s.trim()).filter(Boolean);
        refreshList();
      }, 600);
    });

    root.querySelector('#filter-conds').addEventListener('click', (e) => {
      const del = e.target.closest('.f-del');
      if (del) { this.state.filter.conditions.splice(Number(del.dataset.ci), 1); this.renderPanel(root); refreshList(); return; }
      const rm = e.target.closest('[data-rm]');
      if (rm) {
        const ci = Number(rm.closest('.f-ms') ? rm.closest('.f-ms').dataset.ci : -1);
        const cond = this.state.filter.conditions[ci];
        if (!cond) return;
        cond.v = (cond.v || []).filter((v) => v !== rm.dataset.rm);
        this.renderPanel(root);
        refreshList();
        return;
      }
      const btn = e.target.closest('.f-ms-btn');
      if (btn) {
        const ci = Number(btn.dataset.ci);
        const pop = root.querySelector(`.f-ms-pop[data-ci="${ci}"]`);
        if (pop) pop.hidden = !pop.hidden;
        // 关闭其他浮层
        root.querySelectorAll('.f-ms-pop:not([hidden])').forEach((p) => { if (p !== pop) p.hidden = true; });
        return;
      }
      // 点击条件区外部关闭浮层
      if (!e.target.closest('.f-ms')) root.querySelectorAll('.f-ms-pop').forEach((p) => { p.hidden = true; });
    });
  },

  debouncedRefresh(delay, fn) {
    clearTimeout(this._deb);
    this._deb = setTimeout(fn, delay);
  },

  // 仅重渲条件面板（不重建整页，保持浮层状态）
  renderPanel(root) {
    const condsWrap = root.querySelector('#filter-conds');
    if (condsWrap) condsWrap.innerHTML = this.condsHtml();
  },

  // ECharts 图表渲染
  renderCharts(root) {
    if (!window.echarts) { return; }
    const stats = this.state.stats || {};
    const palette = ['#2563eb', '#0ea5e9', '#16a34a', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6', '#64748b', '#f97316'];

    const pie = (id, data, name) => {
      const el = root.querySelector('#' + id);
      if (!el) return;
      const top = (data || []).slice(0, 8);
      const other = (data || []).slice(8).reduce((s, x) => s + x.c, 0);
      const items = top.map((x, i) => ({ name: x.k, value: x.c, itemStyle: { color: palette[i % palette.length] } }));
      if (other > 0) items.push({ name: '其他', value: other, itemStyle: { color: '#cbd5e1' } });
      if (!items.length) { el.innerHTML = '<div class="chart-empty">暂无数据</div>'; return; }
      el._chart = el._chart || window.echarts.init(el);
      el._chart.setOption({
        tooltip: { trigger: 'item', triggerOn: 'click', renderMode: 'richText', confine: true, formatter: function (p) { return p.name + '：' + p.value + ' 个（' + p.percent + '%）'; } },
        legend: { type: 'scroll', bottom: 0, textStyle: { fontSize: 11 } },
        series: [{ type: 'pie', radius: ['35%', '68%'], center: ['50%', '44%'], data: items, label: { fontSize: 11, formatter: '{b} {d}%' } }],
      });
    };
    const bar = (id, data) => {
      const el = root.querySelector('#' + id);
      if (!el) return;
      const rows = (data || []).slice(0, 8);
      if (!rows.length) { el.innerHTML = '<div class="chart-empty">暂无数据</div>'; return; }
      const names = rows.map((x) => x.k);
      const vals = rows.map((x) => x.c);
      el._chart = el._chart || window.echarts.init(el);
      el._chart.setOption({
        tooltip: { trigger: 'axis', triggerOn: 'click', renderMode: 'richText', confine: true },
        grid: { left: 8, right: 24, top: 20, bottom: 8, containLabel: true },
        xAxis: { type: 'category', data: names, axisLabel: { fontSize: 10, interval: 0, rotate: names.length > 4 ? 24 : 0 } },
        yAxis: { type: 'value', minInterval: 1 },
        series: [{ type: 'bar', data: vals.map((v, i) => ({ value: v, itemStyle: { color: palette[i % palette.length] } })), barWidth: '52%', label: { show: true, position: 'top', fontSize: 10 } }],
      });
    };

    pie('ch-industry', stats.industry, '行业');
    bar('ch-track', stats.job_track);
    bar('ch-edu', stats.education);
    bar('ch-loc', stats.location);
    const eng = (stats.english || []);
    const cert = (stats.cert || []);
    const skill = (stats.skill || []);
    if (!eng.length) { const el = root.querySelector('#ch-english'); if (el) el.innerHTML = '<div class="chart-empty">抓取中…官方公告要求持续解析中</div>'; }
    else pie('ch-english', eng, '英语');
    const elCert = root.querySelector('#ch-cert');
    if (elCert) {
      if (!cert.length && !skill.length) elCert.innerHTML = '<div class="chart-empty">抓取中…官方公告要求持续解析中</div>';
      else {
        elCert._chart = elCert._chart || window.echarts.init(elCert);
        const names = [...cert.map((x) => '证:' + x.k), ...skill.map((x) => '技:' + x.k)].slice(0, 10);
        const vals = [...cert.map((x) => x.c), ...skill.map((x) => x.c)].slice(0, 10);
        elCert._chart.setOption({
          tooltip: { trigger: 'axis', triggerOn: 'click', renderMode: 'richText', confine: true },
          grid: { left: 8, right: 24, top: 20, bottom: 8, containLabel: true },
          xAxis: { type: 'category', data: names, axisLabel: { fontSize: 10, interval: 0, rotate: 30 } },
          yAxis: { type: 'value', minInterval: 1 },
          series: [{ type: 'bar', data: vals.map((v, i) => ({ value: v, itemStyle: { color: palette[i % palette.length] } })), barWidth: '52%', label: { show: true, position: 'top', fontSize: 10 } }],
        });
      }
    }
  },
};
