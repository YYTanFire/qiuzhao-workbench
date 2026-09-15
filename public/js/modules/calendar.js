'use strict';
/**
 * 模块 2：今日作战日历
 */
const Calendar = {
  state: { status: 'all' },

  async render() {
    const { esc, daysLeft, statusPill } = window.App;
    const [items, settings, stats] = await Promise.all([
      API.get('/calendar?status=' + this.state.status),
      API.get('/calendar/settings'),
      API.get('/calendar/stats/overview'),
    ]);
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
            <div class="lo">${esc(a.location || '')}${a.salary_min ? ' · ' + (a.salary_min) + '–' + a.salary_max + 'K' : ''} · ${esc(a.education_required || '')}</div>
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
    }).join('') || window.App.emptyBox('投递计划是空的，去「岗位雷达」加入几个岗位吧', '🗓');

    const statCards = [
      ['计划总数', stats.total, ''],
      ['今日截止', stats.due_today, stats.due_today ? 'danger' : ''],
      ['7 天内', stats.due_week, ''],
      ['紧急(≤' + settings.urgent_days + '天)', stats.urgent, 'urgent'],
      ['预警(≤' + settings.warn_days + '天)', stats.warn, 'warn'],
    ];

    return `
      <div class="stack">
        <div class="stat-grid" style="grid-template-columns:repeat(5,1fr)">
          ${statCards.map(([l, v, cls]) => `<div class="stat-card ${cls === 'danger' ? 'red' : cls === 'urgent' ? 'red' : cls === 'warn' ? 'amber' : ''}"><div class="lbl">${l}</div><div class="num" style="${cls ? 'color:var(--urgent)' : ''}">${v}</div></div>`).join('')}
        </div>

        <div class="card card-pad">
          <div class="between wrap">
            <div>
              <div class="card-title">投递作战时间轴</div>
              <div class="card-sub">按网申截止日期升序 · 橙=预警 红=紧急 绿=已结束</div>
            </div>
            <div class="row wrap">
              <select class="status-select" id="status-filter" style="min-width:110px">
                <option value="all">全部状态</option>
                ${['planned', 'applied', 'written_test', 'interview', 'offer', 'rejected'].map((s) => `<option value="${s}" ${this.state.status === s ? 'selected' : ''}>${({ planned: '待投递', applied: '已投递', written_test: '笔试中', interview: '面试中', offer: '已拿 Offer', rejected: '已淘汰' })[s]}</option>`).join('')}
              </select>
              <button class="btn btn-sm" id="set-btn">⚙ 预警阈值</button>
            </div>
          </div>
          <div class="cal-timeline mt16">${timeline}</div>
        </div>
      </div>`;
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
};
