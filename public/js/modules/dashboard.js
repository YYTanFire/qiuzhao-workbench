'use strict';
/**
 * 总览看板
 */
const Dashboard = {
  async render() {
    const d = await API.get('/dashboard');
    const { esc, statusPill, fmtDate, daysLeft, deadlineChip, fmtSalary } = window.App;
    const b = d.plan.by_status || {};
    const funnel = [
      ['planned', b.planned || 0, '待投递'],
      ['applied', b.applied || 0, '已投递'],
      ['written_test', b.written_test || 0, '笔试'],
      ['interview', b.interview || 0, '面试'],
      ['offer', b.offer || 0, 'Offer'],
      ['rejected', b.rejected || 0, '淘汰'],
    ];
    const up = (d.plan.upcoming || []).map((j) => {
      const dl = j.deadline;
      const left = daysLeft(dl);
      return `<div class="upcoming-item">
        <div class="dl"><b>${dl ? dl.slice(8, 10) : '--'}</b><span>${dl ? dl.slice(5, 7) + '月' : ''}</span></div>
        <div style="flex:1;min-width:0">
          <div style="font-weight:700;font-size:13.5px">${esc(j.company)} · ${esc(j.position)}</div>
          <div class="small muted">${esc(j.location || '')}${j.salary_min ? ' · ' + fmtSalary(j) : ''}</div>
        </div>
        ${deadlineChip(dl)}
      </div>`;
    }).join('') || window.App.emptyBox('未来 7 天没有临近截止的投递，去岗位雷达加一些吧', '📡');

    return `
      <div class="stack">
        <div class="stat-grid">
          <div class="stat-card blue"><div class="lbl">岗位雷达</div><div class="num">${d.jobs.total}</div><div class="extra">${d.jobs.sources} 个数据源聚合</div></div>
          <div class="stat-card amber"><div class="lbl">投递计划</div><div class="num">${d.plan.total}</div><div class="extra">${(b.offer || 0)} 个 Offer · ${(b.interview || 0)} 个面试中</div></div>
          <div class="stat-card green"><div class="lbl">面试作战</div><div class="num">${d.assets.interviews}</div><div class="extra">近 7 天 ${d.assets.interviews_week} 场 · 今日余 ${d.quota.limit - d.quota.used} 次模拟</div></div>
          <div class="stat-card red"><div class="lbl">资产沉淀</div><div class="num">${d.assets.resumes + d.assets.experience_cards + d.assets.knowledge}</div><div class="extra">简历 ${d.assets.resumes} · 经历 ${d.assets.experience_cards} · 资料 ${d.assets.knowledge}</div></div>
        </div>

        <div class="grid g-2">
          <div class="card card-pad">
            <div class="card-title">投递漏斗</div>
            <div class="card-sub">全流程状态分布</div>
            <div class="funnel mt12">
              ${funnel.map(([k, v, l]) => `<div class="f-item ${v ? 'on' : ''}"><b>${v}</b><span>${l}</span></div>`).join('')}
            </div>
          </div>
          <div class="card card-pad">
            <div class="card-title">近 7 天截止提醒</div>
            <div class="card-sub">优先级最高的投递项，先处理它们</div>
            <div class="mt8">${up}</div>
          </div>
        </div>

        <div class="card card-pad">
          <div class="card-title">下一步建议</div>
          <div class="mt8 row wrap" style="gap:10px">
            <button class="btn btn-primary btn-sm" data-go="radar">📡 去岗位雷达找岗位</button>
            <button class="btn btn-sm" data-go="calendar">◷ 查看今日作战日历</button>
            <button class="btn btn-sm" data-go="interview">⚑ 来一场模拟面试（余 ${d.quota.limit - d.quota.used} 次）</button>
            <button class="btn btn-sm" data-go="resume">▤ 定制一份简历</button>
          </div>
        </div>
      </div>`;
  },
  async init(root) {
    root.querySelectorAll('[data-go]').forEach((b) => b.addEventListener('click', () => { location.hash = '#/' + b.dataset.go; }));
  },
};
