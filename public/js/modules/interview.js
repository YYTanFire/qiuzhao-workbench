'use strict';
/**
 * 模块 5：面试作战
 */
const Interview = {
  async render() {
    const { esc } = window.App;
    const [dash, sessions, reviews] = await Promise.all([API.get('/interviews/dashboard'), API.get('/interviews/sessions'), API.get('/interviews/reviews')]);
    const stat = (l, v, cls) => `<div class="stat-card ${cls}"><div class="lbl">${l}</div><div class="num">${v == null ? '--' : v}</div></div>`;
    const sessList = sessions.map((s) => `
      <div class="exp-card">
        <div class="exp-head">
          <div>
            <div class="exp-title">${esc(s.company || '自定义岗位')} · ${esc(s.job_title || '模拟面试')}</div>
            <div class="exp-org">${s.status === 'finished' ? '已完成 · 均分 ' + (s.score ?? '--') : '进行中 · ' + (s.current_question || 0) + ' 题已答'} · ${esc(String(s.created_at).slice(5, 16).replace('T', ' '))}</div>
          </div>
          <span class="pill ${s.status === 'finished' ? 'pill-green' : 'pill-amber'}">${s.status === 'finished' ? '已完成' : '进行中'}</span>
        </div>
        <div class="row mt8" style="gap:8px">
          <button class="btn btn-sm" data-sess="${s.id}">${s.status === 'finished' ? '查看复盘' : '继续面试'}</button>
        </div>
      </div>`).join('') || window.App.emptyBox('还没有模拟面试记录，来一场吧', '⚑');

    const revList = reviews.map((r) => `
      <div class="exp-card">
        <div class="exp-head">
          <div>
            <div class="exp-title">${esc(r.job_title || r.company || '面试复盘')}${r.company ? ' · ' + esc(r.company) : ''}</div>
            <div class="exp-org">${esc(String(r.created_at).slice(5, 16).replace('T', ' '))} · ${(r.analysis.qaCount ?? '?')} 轮问答</div>
          </div>
          <div class="row" style="gap:6px"><button class="btn btn-sm" data-rev="${r.id}">详情</button><button class="btn btn-sm btn-danger" data-revdel="${r.id}">删除</button></div>
        </div>
        <div class="small muted mt8" style="display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden">${esc(r.analysis.summary || '')}</div>
      </div>`).join('') || window.App.emptyBox('还没有面试复盘，导入录音转文字或手动添加', '📝');

    return `
      <div class="stack">
        <div class="stat-grid" style="grid-template-columns:repeat(5,1fr)">
          ${stat('面试总数', dash.total, 'blue')}
          ${stat('本周面试', dash.week, 'green')}
          ${stat('通过率(≥70分)', dash.pass_rate != null ? dash.pass_rate + '%' : '--', 'amber')}
          ${stat('复盘沉淀', dash.reviews, 'red')}
          ${stat('今日模拟余量', dash.quota_limit - dash.quota_used, dash.quota_limit - dash.quota_used > 0 ? 'green' : 'red')}
        </div>

        <div class="card card-pad">
          <div class="card-title">AI 模拟面试</div>
          <div class="card-sub">AI 扮演面试官按流程提问 · 实时评分 + 踩分点分析 · 结束输出复盘报告 · 每日限 ${dash.quota_limit} 次</div>
          <div class="row mt12" style="gap:12px;align-items:stretch">
            <div class="field" style="flex:1.6;margin:0">
              <label>岗位 JD（用于生成面试题库与评分依据）</label>
              <textarea id="mock-jd" placeholder="粘贴岗位 JD…" style="min-height:96px"></textarea>
            </div>
            <div class="field" style="flex:1;margin:0">
              <label>公司 / 岗位名（可选，仅用于记录）</label>
              <input id="mock-company" placeholder="例如：星舟网络" style="margin-bottom:8px" />
              <input id="mock-title" placeholder="例如：Java 后端开发工程师" />
            </div>
            <button class="btn btn-primary" id="mock-start" style="align-self:flex-end">🎤 开始模拟面试</button>
          </div>
        </div>

        <div class="card card-pad">
          <div class="card-title">面试题预测</div>
          <div class="card-sub">基于 JD 生成 4 模块题库：行为面 / 专业面 / HR 面 / 公司专属题</div>
          <div class="row mt12" style="gap:12px;align-items:stretch">
            <div class="field" style="flex:1;margin:0"><textarea id="pred-jd" placeholder="粘贴岗位 JD，点击生成题库…" style="min-height:76px"></textarea></div>
            <button class="btn" id="pred-btn" style="align-self:flex-start">🔮 生成题库</button>
          </div>
          <div id="pred-result" class="mt12"></div>
        </div>

        <div class="grid g-2">
          <div class="card card-pad">
            <div class="card-title">模拟面试记录</div>
            <div class="stack mt12">${sessList}</div>
          </div>
          <div class="card card-pad">
            <div class="between">
              <div><div class="card-title">面试复盘</div><div class="card-sub">导入录音转文字文档，AI 自动解析</div></div>
              <button class="btn btn-sm" id="add-review">＋ 添加复盘</button>
            </div>
            <div class="stack mt12">${revList}</div>
          </div>
        </div>
      </div>`;
  },

  async init(root) {
    const { toast, esc, openModal, closeModal, confirmDialog, spinner } = window.App;
    const refresh = async () => { const pr = document.getElementById('page-root'); pr.innerHTML = '<div class="loading-box"><div class="spinner"></div></div>'; const html = await this.render(); pr.innerHTML = html; await this.init(pr); };

    // 开始模拟面试
    root.querySelector('#mock-start').addEventListener('click', async () => {
      const jd = root.querySelector('#mock-jd').value.trim();
      const company = root.querySelector('#mock-company').value.trim();
      const title = root.querySelector('#mock-title').value.trim();
      if (!jd) return toast('请先粘贴岗位 JD', 'err');
      const btn = root.querySelector('#mock-start');
      btn.disabled = true; btn.textContent = '题库生成中…';
      try {
        const r = await API.post('/interviews/sessions', { jd, company, job_title: title });
        toast('模拟面试开始，共 ' + r.total_questions + ' 题 🎤', 'ok');
        location.hash = '#/interview';
        setTimeout(() => openSession(r.id), 300);
      } catch (err) { toast(err.message, 'err'); }
      btn.disabled = false; btn.textContent = '🎤 开始模拟面试';
    });

    // 题库预测
    root.querySelector('#pred-btn').addEventListener('click', async () => {
      const jd = root.querySelector('#pred-jd').value.trim();
      if (!jd) return toast('请先粘贴岗位 JD', 'err');
      const box = root.querySelector('#pred-result');
      const btn = root.querySelector('#pred-btn');
      btn.disabled = true; btn.textContent = '生成中…';
      box.innerHTML = spinner();
      try {
        const r = await API.post('/interviews/predict', { jd });
        renderBank(r.bank, box);
      } catch (err) { box.innerHTML = `<div class="small muted">${esc(err.message)}</div>`; }
      btn.disabled = false; btn.textContent = '🔮 生成题库';
    });

    function renderBank(bank, box, withStart) {
      const groups = [['行为面', bank.behavior || []], ['专业面', bank.professional || []], ['HR 面', bank.hr || []], ['公司专属', bank.company || []]];
      const html = groups.map(([name, qs]) => `
        <div class="mt12">
          <div class="row" style="gap:8px"><b>${name}</b><span class="pill pill-blue">${qs.length} 题</span></div>
          ${qs.map((q, i) => `
            <details class="mt8" style="background:var(--surface-2);border:1px solid var(--line);border-radius:10px;padding:10px 14px">
              <summary style="cursor:pointer;font-weight:600;font-size:13.5px">${i + 1}. ${esc(q.q)}</summary>
              <div class="qa-detail mt8"><div><b>为什么问：</b>${esc(q.why || '')}</div><div><b>回答证据：</b>${esc(q.evidence || '')}</div><div><b>回答结构：</b>${esc(q.structure || '')}</div></div>
            </details>`).join('')}
        </div>`).join('');
      box.innerHTML = html + (withStart ? `<button class="btn btn-primary btn-sm mt12" id="bank-start">用这份题库开始模拟面试</button>` : '');
    }

    // 打开/继续模拟面试会话
    async function openSession(id) {
      const s = await API.get('/interviews/sessions/' + id);
      const mask = openModal(`
        <div class="modal-head"><h3>模拟面试 · ${esc(s.company || '')} ${esc(s.job_title || '')}</h3><button class="modal-close" data-close>×</button></div>
        <div class="modal-body">
          <div class="row between mb12">
            <span class="small muted">进度 ${s.answered} / ${s.total} · ${s.status === 'finished' ? '已结束' : '进行中'}</span>
            ${s.status !== 'finished' ? '<span class="pill pill-amber">实时评分中</span>' : `<span class="pill pill-green">均分 ${s.score}</span>`}
          </div>
          <div class="progress-bar mb16"><i style="width:${s.total ? Math.round(s.answered / s.total * 100) : 0}%"></i></div>
          <div id="qa-body"></div>
        </div>
        <div class="modal-foot"><button class="btn" data-close>关闭</button><button class="btn btn-primary" id="qa-next" style="display:none">下一题 →</button></div>`);
      mask.querySelector('[data-close]').addEventListener('click', () => closeModal(mask));
      const qaBody = mask.querySelector('#qa-body');

      function renderCurrent(q) {
        qaBody.innerHTML = `
          <div class="qa-card">
            <div class="row" style="gap:8px"><span class="q-tag">${esc(q.group || '')}</span><span class="small muted">${esc(q.id || '')}</span></div>
            <div class="q-text">${esc(q.q)}</div>
            <div class="qa-detail"><b>为什么问：</b>${esc(q.why || '')}<br/><b>回答证据：</b>${esc(q.evidence || '')}<br/><b>回答结构：</b>${esc(q.structure || '')}</div>
            <div class="answer-area mt16"><div class="field" style="margin:0"><label>你的回答（尽量用 STAR + 数据）</label><textarea id="ans-text"></textarea></div></div>
            <button class="btn btn-primary btn-block mt12" id="ans-submit">提交回答</button>
          </div>`;
        mask.querySelector('#ans-submit').addEventListener('click', async () => {
          const ans = mask.querySelector('#ans-text').value.trim();
          if (!ans) return toast('请先写下回答', 'err');
          const btn = mask.querySelector('#ans-submit');
          btn.disabled = true; btn.textContent = '评分中…';
          try {
            const r = await API.post('/interviews/sessions/' + id + '/answer', { answer: ans });
            renderScore(r);
          } catch (err) { toast(err.message, 'err'); }
          btn.disabled = false; btn.textContent = '提交回答';
        });
      }

      function renderScore(r) {
        const cls = r.score >= 70 ? 'good' : r.score >= 50 ? 'mid' : 'bad';
        const missed = (r.missed || []).map((m) => `<li>${esc(m)}</li>`).join('');
        const tips = (r.tips || []).map((t, i) => `<div class="sug-item"><div class="idx">${i + 1}</div><div class="small">${esc(t)}</div></div>`).join('');
        qaBody.innerHTML = `
          <div class="qa-card">
            <div class="between">
              <div><span class="q-tag">${esc(r.finished ? '面试完成 🎉' : '本题得分')}</span></div>
              <div class="score-badge ${cls}">${r.score} 分</div>
            </div>
            <div class="mt8 small">${esc(r.feedback || '')}</div>
            ${missed ? `<div class="mt12"><b class="small">踩分点分析</b><ul class="small muted mt8" style="margin-left:18px">${missed}</ul></div>` : ''}
            ${tips ? `<div class="mt12"><b class="small">优化参考</b><div>${tips}</div></div>` : ''}
            ${r.next_question ? '' : ''}
          </div>`;
        const nextBtn = mask.querySelector('#qa-next');
        if (r.finished) {
          nextBtn.style.display = 'none';
          mask.querySelector('.modal-foot').insertAdjacentHTML('beforeend', '<button class="btn btn-primary" id="show-report">📊 查看复盘报告</button>');
          mask.querySelector('#show-report').addEventListener('click', async () => {
            try {
              const rep = await API.get('/interviews/sessions/' + id + '/report');
              renderReport(rep);
            } catch (err) { toast(err.message, 'err'); }
          });
        } else {
          nextBtn.style.display = 'inline-flex';
          nextBtn.onclick = () => renderCurrent(r.next_question);
        }
      }

      function renderReport(rep) {
        qaBody.innerHTML = `
          <div class="stack">
            <div class="report-block">
              <div class="between"><b>复盘报告</b><span class="score-badge ${rep.score >= 70 ? 'good' : rep.score >= 50 ? 'mid' : 'bad'}">${rep.score} 分</span></div>
              <div class="small mt8">${esc((rep.report && rep.report.summary) || '')}</div>
            </div>
            ${(rep.report && rep.report.byGroup || []).map((g) => `
              <div class="report-block">
                <div class="between"><b>${esc(g.group)}</b><span class="pill ${g.avg >= 70 ? 'pill-green' : g.avg >= 50 ? 'pill-amber' : 'pill-red'}">均分 ${g.avg}</span></div>
                <div class="progress-bar mt8"><i style="width:${g.avg}%"></i></div>
              </div>`).join('')}
            ${(rep.report && rep.report.low_questions || []).length ? `<div class="report-block"><b>薄弱题回顾</b>${rep.report.low_questions.map((q) => `<div class="small mt8">· ${esc(q.question)} <span class="pill pill-red">${q.score} 分</span></div>`).join('')}</div>` : ''}
            <div class="report-block">
              <b>全部作答明细</b>
              ${(rep.answers || []).map((a, i) => `
                <details class="mt8" style="background:var(--surface);border:1px solid var(--line);border-radius:10px;padding:8px 12px">
                  <summary style="cursor:pointer;font-size:13px;font-weight:600">${i + 1}. [${esc(a.group || '')}] ${esc(a.q)} <span class="pill ${a.score >= 70 ? 'pill-green' : a.score >= 50 ? 'pill-amber' : 'pill-red'}">${a.score}</span></summary>
                  <div class="small mt8 muted" style="white-space:pre-wrap">${esc(a.answer || '')}</div>
                </details>`).join('')}
            </div>
          </div>`;
      }

      if (s.status === 'finished') {
        const rep = await API.get('/interviews/sessions/' + id + '/report');
        renderReport(rep);
        mask.querySelector('#qa-next').style.display = 'none';
      } else if (s.current_question) {
        renderCurrent(s.current_question);
      } else {
        qaBody.innerHTML = window.App.emptyBox('题库为空', '⚠️');
      }
    }

    root.querySelectorAll('[data-sess]').forEach((b) => b.addEventListener('click', () => openSession(b.dataset.sess)));

    // 复盘详情/删除
    root.querySelectorAll('[data-rev]').forEach((b) => b.addEventListener('click', async () => {
      const list = await API.get('/interviews/reviews');
      const r = list.find((x) => x.id === Number(b.dataset.rev));
      if (!r) return;
      const mask = openModal(`
        <div class="modal-head"><h3>${esc(r.job_title || r.company || '面试复盘')}</h3><button class="modal-close" data-close>×</button></div>
        <div class="modal-body">
          <div class="report-block"><b>整体评价</b><div class="small mt8">${esc(r.analysis.summary || '')}</div></div>
          <div class="mt12 row wrap" style="gap:8px">
            ${(r.analysis.good || []).map((g) => `<span class="pill pill-green">✓ ${esc(g)}</span>`).join('')}
            ${(r.analysis.weak || []).map((w) => `<span class="pill pill-red">! ${esc(w)}</span>`).join('')}
          </div>
          <div class="mt12"><b class="small">对话原文</b><div class="resume-preview mt8" style="max-height:220px;overflow:auto;font-size:12.5px">${esc(r.transcript || '')}</div></div>
        </div>
        <div class="modal-foot"><button class="btn" data-close>关闭</button></div>`);
      mask.querySelector('[data-close]').addEventListener('click', () => closeModal(mask));
    }));
    root.querySelectorAll('[data-revdel]').forEach((b) => b.addEventListener('click', () => {
      confirmDialog('确定删除这条复盘记录吗？', async () => {
        try { await API.del('/interviews/reviews/' + b.dataset.revdel); toast('已删除', 'ok'); refresh(); }
        catch (err) { toast(err.message, 'err'); }
      });
    }));

    // 添加复盘（导入录音转文字 / 手动）
    root.querySelector('#add-review').addEventListener('click', () => {
      const mask = openModal(`
        <div class="modal-head"><h3>添加面试复盘</h3><button class="modal-close" data-close>×</button></div>
        <div class="modal-body">
          <div class="row" style="gap:12px">
            <div class="field" style="flex:1"><label>公司（可选）</label><input id="r-company" placeholder="例如：星舟网络" /></div>
            <div class="field" style="flex:1"><label>岗位（可选）</label><input id="r-title" placeholder="例如：Java 后端开发工程师" /></div>
          </div>
          <div class="field"><label>面试对话文本（可粘贴录音转文字结果）</label>
            <textarea id="r-transcript" placeholder="面试官：…&#10;我：…&#10;（建议保留提问与回答结构）" style="min-height:180px"></textarea>
          </div>
        </div>
        <div class="modal-foot"><button class="btn" data-close>取消</button><button class="btn btn-primary" id="save-review">AI 解析并保存</button></div>`);
      mask.querySelector('[data-close]').addEventListener('click', () => closeModal(mask));
      mask.querySelector('#save-review').addEventListener('click', async () => {
        const transcript = mask.querySelector('#r-transcript').value.trim();
        if (!transcript) return toast('请粘贴面试对话文本', 'err');
        const btn = mask.querySelector('#save-review');
        btn.disabled = true; btn.textContent = '解析中…';
        try {
          await API.post('/interviews/reviews', { transcript, company: mask.querySelector('#r-company').value.trim(), job_title: mask.querySelector('#r-title').value.trim() });
          toast('复盘已生成并保存', 'ok');
          closeModal(mask);
          refresh();
        } catch (err) { toast(err.message, 'err'); }
        btn.disabled = false; btn.textContent = 'AI 解析并保存';
      });
    });
  },
};
