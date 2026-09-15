'use strict';
/**
 * 模块 3：定制简历
 */
const Resume = {
  async render() {
    const { esc } = window.App;
    const versions = await API.get('/resumes');
    const lib = versions.length
      ? versions.map((v) => `
        <div class="exp-card">
          <div class="exp-head">
            <div>
              <div class="exp-title">${esc(v.title)}</div>
              <div class="exp-org">${v.job_title ? esc(v.job_title) : '通用版本'} · ${esc(String(v.created_at).slice(0, 16).replace('T', ' '))}</div>
            </div>
            <div class="row" style="gap:8px">
              <span class="score-ring" style="--p:${v.score};width:56px;height:56px"><b style="font-size:14px">${v.score}</b><small>匹配</small></span>
            </div>
          </div>
          <div class="row mt8" style="gap:8px">
            <span class="pill ${v.mode === 'ai' ? 'pill-green' : 'pill-gray'}">${v.mode === 'ai' ? 'AI 生成' : '内置引擎'}</span>
            <button class="btn btn-sm" data-view="${v.id}">查看</button>
            <button class="btn btn-sm btn-danger" data-del="${v.id}">删除</button>
          </div>
        </div>`).join('')
      : window.App.emptyBox('还没有生成过定制简历', '▤');

    return `
      <div class="stack">
        <div class="card card-pad">
          <div class="card-title">一键定制简历</div>
          <div class="card-sub">通用版简历 + 目标岗位 JD → AI 生成匹配版 · 自动脱敏 · 每版自动入库</div>
          <div class="split-pane mt16">
            <div class="stack">
              <div class="field">
                <label>通用版简历（粘贴文本，或上传 Word/PDF）</label>
                <div class="dropzone" id="resume-drop">点击或拖拽上传 <b>.docx / .pdf / .txt</b><div class="fname" id="resume-fname"></div></div>
                <textarea id="base-resume" placeholder="粘贴你的通用版简历全文，包含教育、实习、项目、技能等经历…" style="min-height:230px"></textarea>
              </div>
              <div class="field">
                <label>目标岗位 JD（粘贴文字 / 截图 OCR 文字）</label>
                <textarea id="jd-text" placeholder="粘贴目标岗位的职位描述（JD）…" style="min-height:150px"></textarea>
              </div>
              <button class="btn btn-primary btn-block" id="gen-btn">⚡ 一键生成定制简历</button>
            </div>
            <div class="card" id="result-box" style="background:var(--surface-2);border-style:dashed">
              <div class="empty" style="padding:60px 20px"><div class="ico">✨</div>生成结果将在这里展示<br /><span class="small">匹配度评分 · 定制版预览 · 逐段优化建议</span></div>
            </div>
          </div>
        </div>

        <div class="card card-pad">
          <div class="card-title">简历版本库</div>
          <div class="card-sub">每次生成自动入库，关联对应岗位</div>
          <div class="grid g-2 mt12">${lib}</div>
        </div>
      </div>`;
  },

  async init(root) {
    const { toast, fileToBase64, bindDropzone, esc, openModal, closeModal, confirmDialog, spinner } = window.App;
    let fileData = null;

    const dz = root.querySelector('#resume-drop');
    bindDropzone(dz, async (f) => {
      if (!f) return;
      if (!/\.(docx|pdf|txt|md)$/i.test(f.name)) return toast('仅支持 .docx / .pdf / .txt', 'err');
      fileData = { name: f.name, base64: await fileToBase64(f) };
      root.querySelector('#resume-fname').textContent = '✓ ' + f.name + '（已读取，可继续粘贴/编辑）';
      toast('文件已读取：' + f.name, 'ok');
    });

    root.querySelector('#gen-btn').addEventListener('click', async () => {
      const base = root.querySelector('#base-resume').value.trim();
      const jd = root.querySelector('#jd-text').value.trim();
      if (!base && !fileData) return toast('请先提供通用版简历（粘贴或上传）', 'err');
      if (!jd) return toast('请提供目标岗位 JD', 'err');
      const btn = root.querySelector('#gen-btn');
      btn.disabled = true; btn.textContent = 'AI 生成中，请稍候…';
      const box = root.querySelector('#result-box');
      box.innerHTML = spinner();
      try {
        const r = await API.post('/resumes/generate', { base_resume: base, jd, raw_files: fileData ? [fileData] : undefined });
        renderResult(r);
        toast('定制简历已生成并存入版本库', 'ok');
        setTimeout(() => window.App.route(), 600);
      } catch (err) {
        box.innerHTML = `<div class="empty"><div class="ico">⚠️</div><div>${esc(err.message)}</div></div>`;
        toast(err.message, 'err');
      }
      btn.disabled = false; btn.textContent = '⚡ 一键生成定制简历';
    });

    function renderResult(r) {
      const c = r.content || {};
      const secHtml = (label, val) => (val ? `<h5>${label}</h5><div>${esc(val)}</div>` : '');
      const sugHtml = (r.suggestions || []).map((s, i) => `
        <div class="sug-item"><div class="idx">${i + 1}</div>
          <div><b>${esc(s.section || '')}</b><div class="small muted">${esc(s.tip || '')}</div></div>
        </div>`).join('') || '<div class="small muted">暂无建议</div>';
      box.innerHTML = `
        <div class="between" style="padding:6px 4px 0">
          <span class="pill ${r.mode === 'ai' ? 'pill-green' : 'pill-gray'}">${r.mode === 'ai' ? '真实 AI 生成' : '内置引擎生成'}</span>
          <span class="small muted">${esc(r.title || '')}</span>
        </div>
        <div class="row mt8" style="gap:16px">
          <div class="score-ring" style="--p:${r.score}"><b>${r.score}</b><small>岗位匹配</small></div>
          <div style="flex:1">
            <div class="card-sub mb8">定制版简历（自动脱敏）</div>
            <div class="resume-preview" style="max-height:300px;overflow:auto">
              ${c.head ? `<div style="text-align:center;margin-bottom:8px"><b style="font-size:14px">${esc(c.head.name || '')}</b><br/><span class="small">${esc(c.head.contact || '')}</span><br/><span style="color:var(--brand-deep)">${esc(c.head.intent || '')}</span></div>` : ''}
              ${secHtml('教育经历', c.education)}${secHtml('实习经历', c.internship)}${secHtml('项目经历', c.projects)}${secHtml('专业技能', c.skills)}${secHtml('自我评价', c.selfEval)}
            </div>
          </div>
        </div>
        <div class="mt12" style="border-top:1px solid var(--line);padding-top:12px">
          <div class="card-sub mb8">逐段优化建议</div>
          ${sugHtml}
        </div>`;
    }

    root.querySelectorAll('[data-view]').forEach((b) => b.addEventListener('click', async () => {
      const v = await API.get('/resumes/' + b.dataset.view);
      const c = v.content || {};
      const secHtml = (l, val) => (val ? `<h5>${l}</h5><div>${esc(val)}</div>` : '');
      const mask = openModal(`
        <div class="modal-head"><h3>${esc(v.title)}</h3><button class="modal-close" data-close>×</button></div>
        <div class="modal-body">
          <div class="row" style="gap:10px;margin-bottom:12px">
            <span class="score-ring" style="--p:${v.score};width:64px;height:64px"><b style="font-size:16px">${v.score}</b><small>匹配</small></span>
            <div class="small muted">生成于 ${esc(String(v.created_at).slice(0, 16).replace('T', ' '))} · ${v.mode === 'ai' ? '真实 AI' : '内置引擎'}</div>
          </div>
          <div class="resume-preview">
            ${c.head ? `<div style="text-align:center;margin-bottom:8px"><b style="font-size:14px">${esc(c.head.name || '')}</b><br/><span class="small">${esc(c.head.contact || '')}</span><br/><span style="color:var(--brand-deep)">${esc(c.head.intent || '')}</span></div>` : ''}
            ${secHtml('教育经历', c.education)}${secHtml('实习经历', c.internship)}${secHtml('项目经历', c.projects)}${secHtml('专业技能', c.skills)}${secHtml('自我评价', c.selfEval)}
          </div>
          <div class="mt12"><div class="card-sub mb8">逐段优化建议</div>
            ${(v.suggestions || []).map((s, i) => `<div class="sug-item"><div class="idx">${i + 1}</div><div><b>${esc(s.section || '')}</b><div class="small muted">${esc(s.tip || '')}</div></div></div>`).join('')}
          </div>
        </div>
        <div class="modal-foot"><button class="btn" data-close>关闭</button></div>`);
      mask.querySelector('[data-close]').addEventListener('click', () => closeModal(mask));
    }));

    root.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', () => {
      confirmDialog('确定删除这份简历版本吗？', async () => {
        try { await API.del('/resumes/' + b.dataset.del); toast('已删除', 'ok'); window.App.route(); }
        catch (err) { toast(err.message, 'err'); }
      });
    }));
  },
};
