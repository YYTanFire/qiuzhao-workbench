'use strict';
/**
 * 模块 4：经历资产
 */
const Experience = {
  state: { filter: 'all' },
  TYPE_LABEL: { education: ['教育', 'pill-blue'], internship: ['实习', 'pill-sky'], project: ['项目', 'pill-amber'], skill: ['技能', 'pill-green'] },

  async render() {
    const { esc } = window.App;
    const cards = await API.get('/experiences' + (this.state.filter !== 'all' ? '?card_type=' + this.state.filter : ''));
    const list = cards.map((c) => {
      const [tl, tc] = this.TYPE_LABEL[c.card_type] || ['经历', 'pill-gray'];
      const points = (c.content || []).map((p) => `<li>${esc(p)}</li>`).join('');
      return `
      <div class="exp-card" data-card="${c.id}">
        <div class="exp-head">
          <div>
            <span class="pill ${tc}">${tl}</span>
            <div class="exp-title">${esc(c.title || '未命名')}</div>
            <div class="exp-org">${esc(c.org || '')}${c.period ? ' · ' + esc(c.period) : ''}</div>
          </div>
          <div class="row" style="gap:6px;flex:none">
            <button class="btn btn-sm btn-ghost" data-coach="${c.id}" title="AI 教练深挖">🎓 深挖</button>
            <button class="btn btn-sm" data-edit="${c.id}">编辑</button>
            <button class="btn btn-sm btn-danger" data-del="${c.id}">删除</button>
          </div>
        </div>
        ${points ? `<ul class="exp-list">${points}</ul>` : ''}
        <div class="row mt8 wrap" style="gap:4px">
          ${(c.tags || []).map((t) => `<span class="tag">${esc(t)}</span>`).join('')}
          ${c.settled ? '<span class="pill pill-green">已沉淀</span>' : ''}
          <span class="small muted" style="margin-left:auto">${esc(String(c.updated_at || c.created_at || '').slice(5, 16).replace('T', ' '))}</span>
        </div>
      </div>`;
    }).join('') || window.App.emptyBox('还没有经历卡片，先用「简历自动拆解」或手动添加', '❖');

    return `
      <div class="stack">
        <div class="card card-pad">
          <div class="card-title">简历自动拆解</div>
          <div class="card-sub">上传初版简历，AI 自动拆成结构化经历卡片（教育 / 实习 / 项目 / 技能）</div>
          <div class="row mt12" style="gap:12px;align-items:stretch">
            <div class="field" style="flex:1;margin:0">
              <div class="dropzone" id="parse-drop">点击或拖拽上传 <b>.docx / .pdf / .txt</b><div class="fname" id="parse-fname"></div></div>
            </div>
            <div class="field" style="flex:1.4;margin:0">
              <textarea id="parse-text" placeholder="或直接粘贴简历全文，然后点「开始拆解」…" style="min-height:64px"></textarea>
            </div>
            <button class="btn btn-primary" id="parse-btn" style="align-self:flex-start">开始拆解</button>
          </div>
        </div>

        <div class="section-head">
          <div><h2>经历卡片</h2><div class="sub">沉淀内容仅作为补充素材，不改变通用简历原有结构</div></div>
          <div class="row" style="gap:8px">
            <select class="status-select" id="type-filter">
              <option value="all">全部类型</option>
              <option value="education" ${this.state.filter === 'education' ? 'selected' : ''}>教育</option>
              <option value="internship" ${this.state.filter === 'internship' ? 'selected' : ''}>实习</option>
              <option value="project" ${this.state.filter === 'project' ? 'selected' : ''}>项目</option>
              <option value="skill" ${this.state.filter === 'skill' ? 'selected' : ''}>技能</option>
            </select>
            <button class="btn btn-sm" id="add-card">＋ 手动添加</button>
          </div>
        </div>
        <div class="grid g-2">${list}</div>
      </div>`;
  },

  async init(root) {
    const { toast, fileToBase64, bindDropzone, esc, openModal, closeModal, confirmDialog, spinner } = window.App;
    const refresh = async () => { const pr = document.getElementById('page-root'); pr.innerHTML = '<div class="loading-box"><div class="spinner"></div></div>'; const html = await this.render(); pr.innerHTML = html; await this.init(pr); };
    let fileData = null;

    const dz = root.querySelector('#parse-drop');
    bindDropzone(dz, async (f) => {
      if (!f) return;
      if (!/\.(docx|pdf|txt|md)$/i.test(f.name)) return toast('仅支持 .docx / .pdf / .txt', 'err');
      fileData = { name: f.name, base64: await fileToBase64(f) };
      root.querySelector('#parse-fname').textContent = '✓ ' + f.name;
    });

    root.querySelector('#parse-btn').addEventListener('click', async () => {
      const text = root.querySelector('#parse-text').value.trim();
      if (!text && !fileData) return toast('请先粘贴简历或上传文件', 'err');
      const btn = root.querySelector('#parse-btn');
      btn.disabled = true; btn.textContent = '拆解中…';
      try {
        const r = await API.post('/experiences/parse', { resume_text: text, raw_files: fileData ? [fileData] : undefined });
        toast(`拆解完成，生成 ${r.inserted} 张经历卡片`, 'ok');
        refresh();
      } catch (err) { toast(err.message, 'err'); }
      btn.disabled = false; btn.textContent = '开始拆解';
    });

    root.querySelector('#type-filter').addEventListener('change', (e) => { this.state.filter = e.target.value; refresh(); });

    root.querySelector('#add-card').addEventListener('click', () => {
      const mask = openModal(`
        <div class="modal-head"><h3>手动添加经历卡片</h3><button class="modal-close" data-close>×</button></div>
        <div class="modal-body">
          <div class="field"><label>类型</label><select id="c-type"><option value="education">教育</option><option value="internship">实习</option><option value="project">项目</option><option value="skill">技能</option></select></div>
          <div class="row" style="gap:12px">
            <div class="field" style="flex:1"><label>标题</label><input id="c-title" placeholder="例如：XX 公司数据分析实习" /></div>
            <div class="field" style="flex:1"><label>组织 / 单位</label><input id="c-org" placeholder="例如：XX 科技" /></div>
          </div>
          <div class="field"><label>时间</label><input id="c-period" placeholder="例如：2026.06 – 2026.09" /></div>
          <div class="field"><label>要点（每行一条）</label><textarea id="c-content" placeholder="负责…&#10;通过…使…提升…%"></textarea></div>
          <div class="field"><label>标签（逗号分隔）</label><input id="c-tags" placeholder="例如：数据分析, 可视化" /></div>
        </div>
        <div class="modal-foot"><button class="btn" data-close>取消</button><button class="btn btn-primary" id="save-card">保存</button></div>`);
      mask.querySelector('[data-close]').addEventListener('click', () => closeModal(mask));
      mask.querySelector('#save-card').addEventListener('click', async () => {
        const body = {
          card_type: mask.querySelector('#c-type').value,
          title: mask.querySelector('#c-title').value.trim(),
          org: mask.querySelector('#c-org').value.trim(),
          period: mask.querySelector('#c-period').value.trim(),
          content: mask.querySelector('#c-content').value.split('\n').map((s) => s.trim()).filter(Boolean),
          tags: mask.querySelector('#c-tags').value.split(/[,，]/).map((s) => s.trim()).filter(Boolean),
        };
        if (!body.title) return toast('请填写标题', 'err');
        try { await API.post('/experiences', body); toast('卡片已添加', 'ok'); closeModal(mask); refresh(); }
        catch (err) { toast(err.message, 'err'); }
      });
    });

    root.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', async () => {
      const cards = await API.get('/experiences');
      const c = cards.find((x) => x.id === Number(b.dataset.edit));
      if (!c) return;
      const mask = openModal(`
        <div class="modal-head"><h3>编辑经历卡片</h3><button class="modal-close" data-close>×</button></div>
        <div class="modal-body">
          <div class="field"><label>类型</label><select id="c-type"><option value="education" ${c.card_type === 'education' ? 'selected' : ''}>教育</option><option value="internship" ${c.card_type === 'internship' ? 'selected' : ''}>实习</option><option value="project" ${c.card_type === 'project' ? 'selected' : ''}>项目</option><option value="skill" ${c.card_type === 'skill' ? 'selected' : ''}>技能</option></select></div>
          <div class="row" style="gap:12px">
            <div class="field" style="flex:1"><label>标题</label><input id="c-title" value="${esc(c.title)}" /></div>
            <div class="field" style="flex:1"><label>组织 / 单位</label><input id="c-org" value="${esc(c.org)}" /></div>
          </div>
          <div class="field"><label>时间</label><input id="c-period" value="${esc(c.period)}" /></div>
          <div class="field"><label>要点（每行一条）</label><textarea id="c-content">${esc((c.content || []).join('\n'))}</textarea></div>
          <div class="field"><label>标签（逗号分隔）</label><input id="c-tags" value="${esc((c.tags || []).join(','))}" /></div>
        </div>
        <div class="modal-foot"><button class="btn" data-close>取消</button><button class="btn btn-primary" id="save-card">保存</button></div>`);
      mask.querySelector('[data-close]').addEventListener('click', () => closeModal(mask));
      mask.querySelector('#save-card').addEventListener('click', async () => {
        try {
          await API.put('/experiences/' + c.id, {
            card_type: mask.querySelector('#c-type').value, title: mask.querySelector('#c-title').value.trim(),
            org: mask.querySelector('#c-org').value.trim(), period: mask.querySelector('#c-period').value.trim(),
            content: mask.querySelector('#c-content').value.split('\n').map((s) => s.trim()).filter(Boolean),
            tags: mask.querySelector('#c-tags').value.split(/[,，]/).map((s) => s.trim()).filter(Boolean),
          });
          toast('已保存', 'ok'); closeModal(mask); refresh();
        } catch (err) { toast(err.message, 'err'); }
      });
    }));

    root.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', () => {
      confirmDialog('确定删除这张经历卡片吗？', async () => {
        try { await API.del('/experiences/' + b.dataset.del); toast('已删除', 'ok'); refresh(); }
        catch (err) { toast(err.message, 'err'); }
      });
    }));

    // AI 教练深挖
    root.querySelectorAll('[data-coach]').forEach((b) => b.addEventListener('click', async () => {
      const cid = b.dataset.coach;
      const [cards, hist] = await Promise.all([API.get('/experiences'), API.get('/experiences/' + cid + '/coach')]);
      const card = cards.find((x) => x.id === Number(cid));
      if (!card) return;
      const mask = openModal(`
        <div class="modal-head"><h3>AI 教练 · 深挖「${esc(card.title)}」</h3><button class="modal-close" data-close>×</button></div>
        <div class="modal-body">
          <div class="small muted mb12">AI 教练逐轮追问，帮你把这段经历挖出「角色贡献 → 难点解决 → 量化结果」，2-3 轮后可沉淀到经历资产。</div>
          <div class="stack" id="coach-thread">
            ${(hist.history || []).map((h) => `<div class="coach-bubble q">${esc(h.q)}</div><div class="coach-bubble a">${esc(h.a)}</div>`).join('')}
          </div>
          <div id="coach-questions"></div>
          <div id="coach-answer" style="display:none">
            <div class="field mt12"><label>你的回答</label><textarea id="coach-answer-text" style="min-height:90px"></textarea></div>
            <button class="btn btn-primary" id="coach-submit">提交回答</button>
          </div>
          <div id="coach-settle" style="display:none" class="mt12"></div>
        </div>
        <div class="modal-foot"><button class="btn" data-close>关闭</button></div>`);
      mask.querySelector('[data-close]').addEventListener('click', () => closeModal(mask));
      const thread = mask.querySelector('#coach-thread');
      const qBox = mask.querySelector('#coach-questions');
      const aBox = mask.querySelector('#coach-answer');
      const settleBox = mask.querySelector('#coach-settle');
      let history = hist.history || [];
      let currentRound = hist.round || 1;
      let currentQuestions = [];

      async function nextRound() {
        qBox.innerHTML = spinner();
        aBox.style.display = 'none';
        try {
          const r = await API.post('/experiences/' + cid + '/coach', {});
          history = r.history || [];
          currentRound = r.round;
          renderQuestions(r);
        } catch (err) { qBox.innerHTML = `<div class="small muted">${esc(err.message)}</div>`; }
      }

      function renderQuestions(r) {
        if (r.done) return showSettle();
        currentQuestions = (r.questions || []).map((q) => q.q);
        qBox.innerHTML = `
          <div class="small muted mt12 mb8">第 ${r.round} 轮追问（已完成 ${history.length} 轮）</div>
          ${(r.questions || []).map((q, i) => `<div class="coach-q-row mt8"><div class="n">${i + 1}</div><div style="flex:1"><div class="coach-bubble q">${esc(q.q)}</div><div class="small muted" style="margin:5px 0 0 12px">💡 ${esc(q.why || '')}</div></div></div>`).join('')}
          ${r.can_settle ? '<div class="mt12"><button class="btn btn-sm" id="go-settle">已足够，去沉淀 →</button></div>' : ''}`;
        qBox.querySelectorAll('#go-settle').forEach((btn) => btn.addEventListener('click', () => {
          qBox.innerHTML = ''; aBox.style.display = 'none'; showSettle();
        }));
        // 下一轮：先答上一轮的问题
        const askNext = () => {
          aBox.style.display = 'block';
          const submit = mask.querySelector('#coach-submit');
          submit.onclick = async () => {
            const ans = mask.querySelector('#coach-answer-text').value.trim();
            if (!ans) return toast('请先写下回答', 'err');
            submit.disabled = true; submit.textContent = '提交中…';
            try {
              const r2 = await API.post('/experiences/' + cid + '/coach', { question: currentQuestions.join('；'), answer: ans });
              history = r2.history || [];
              currentRound = r2.round;
              mask.querySelector('#coach-answer-text').value = '';
              renderThread();
              if (r2.done) { aBox.style.display = 'none'; return showSettle(); }
              renderQuestions(r2);
            } catch (err) { toast(err.message, 'err'); }
            submit.disabled = false; submit.textContent = '提交回答';
          };
        };
        askNext();
      }

      function renderThread() {
        thread.innerHTML = history.map((h) => `<div class="coach-bubble q">${esc(h.q)}</div><div class="coach-bubble a">${esc(h.a)}</div>`).join('');
      }

      function showSettle() {
        settleBox.style.display = 'block';
        const mined = history.map((h) => h.a).filter(Boolean).join('\n');
        settleBox.innerHTML = `
          <div class="report-block">
            <b>沉淀到经历资产</b>
            <div class="small muted mt8">AI 已从追问中提炼素材，合并入经历卡片（保留原结构，只做补充）：</div>
            <div class="resume-preview mt8" style="max-height:160px;overflow:auto;font-size:12.5px">${esc(mined || '（未采集到回答内容）')}</div>
            <button class="btn btn-primary btn-sm mt12" id="do-settle">✓ 确认沉淀</button>
          </div>`;
        settleBox.querySelector('#do-settle').addEventListener('click', async () => {
          try {
            await API.post('/experiences/' + cid + '/settle', { content: mined.split('\n').filter(Boolean) });
            toast('已沉淀到经历资产 🎉', 'ok');
            closeModal(mask);
            refresh();
          } catch (err) { toast(err.message, 'err'); }
        });
      }

      if (!history.length) nextRound(); else renderQuestions({ round: currentRound, can_settle: history.length >= 3, questions: [], done: false });
    }));
  },
};
