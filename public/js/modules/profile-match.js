'use strict';
/**
 * 模块 8：智能匹配 —— 上传初始简历 → 生成真实行业画像 → 联动岗位雷达筛选
 * 行业名 100% 来自数据库真实 industry 值，岗位数为实时统计
 */
const ProfileMatch = {
  state: { text: '', saved: false, industries: [], selected: [], loading: false },

  async render() {
    const { esc, emptyBox } = window.App;
    const ind = this.state.industries;
    const cards = ind.map((x, i) => `
      <div class="match-card ${this.state.selected.includes(x.industry) ? 'on' : ''}" data-industry="${esc(x.industry)}">
        <div class="match-head">
          <label class="match-check"><input type="checkbox" data-ind="${esc(x.industry)}" ${this.state.selected.includes(x.industry) ? 'checked' : ''} /><span></span></label>
          <div class="match-name">${esc(x.industry)}</div>
          <span class="pill pill-blue">${x.job_count} 个岗位</span>
        </div>
        <div class="match-bar"><i style="width:${Math.max(8, x.pct)}%"></i></div>
        <div class="match-meta">
          <span class="match-pct">匹配度 ${x.pct}%</span>
          <div class="match-kws">${x.keywords.map((k) => `<span class="tag">${esc(k)}</span>`).join('')}</div>
        </div>
        <div class="between">
          <span class="small muted">命中 ${x.keywords.length} 项技能关键词</span>
          <div class="row" style="gap:6px">
            <button class="btn btn-sm" data-batch-add="${esc(x.industry)}" title="把该行业全部岗位一键加入投递计划">⏳ 待投递</button>
            <button class="btn btn-sm btn-primary" data-go="${esc(x.industry)}">去筛选 →</button>
          </div>
        </div>
      </div>`).join('');

    return `
      <div class="stack">
        <div class="card card-pad">
          <div class="between wrap">
            <div>
              <h3 style="margin:0">🧑‍💻 我的行业画像</h3>
              <div class="small muted mt4">上传你的初始简历，系统根据技能/方向匹配数据库中的<strong>真实行业</strong>，一键联动岗位雷达筛选，不用一家家找。</div>
            </div>
            <button class="btn btn-sm" id="pm-load-saved" title="载入已保存的简历">📄 载入已保存简历</button>
          </div>
        </div>

        <div class="grid g-2">
          <div class="card card-pad">
            <div class="between">
              <h4 style="margin:0">① 简历</h4>
              <span class="small muted" id="pm-saved-hint">${this.state.saved ? '✅ 已保存' : '未保存'}</span>
            </div>
            <div class="dropzone mt12" id="pm-dropzone">点击或拖拽上传 Word(.docx) / PDF / TXT</div>
            <input type="file" id="pm-file" accept=".txt,.md,.csv,.docx,.pdf" hidden />
            <textarea class="pm-textarea mt12" id="pm-text" placeholder="也可以直接粘贴简历文本（教育经历、专业技能、项目经历、证书…）">${esc(this.state.text)}</textarea>
            <div class="between mt12">
              <button class="btn" id="pm-save">💾 保存简历</button>
              <button class="btn btn-primary" id="pm-match" ${this.state.loading ? 'disabled' : ''}>${this.state.loading ? '分析中…' : '🔍 生成我的行业画像'}</button>
            </div>
          </div>

          <div class="card card-pad">
            <div class="between">
              <h4 style="margin:0">② 推荐行业（真实岗位分布）</h4>
              <div class="row" style="gap:8px">
                <button class="btn btn-sm" id="pm-batch-plan" ${this.state.selected.length ? '' : 'disabled'} title="把已勾选行业的全部岗位一键加入投递计划">⏳ 一键待投递 (${this.state.selected.length})</button>
                <button class="btn btn-sm btn-primary" id="pm-go-radar" ${this.state.selected.length ? '' : 'disabled'}>在岗位雷达中筛选 (${this.state.selected.length})</button>
              </div>
            </div>
            <div class="mt12" id="pm-result">
              ${ind.length ? `<div class="grid g-2">${cards}</div>` : emptyBox('上传简历并点击「生成我的行业画像」，这里会显示与你匹配的行业', '🎯')}
            </div>
          </div>
        </div>
      </div>`;
  },

  async init(root) {
    const { toast, esc, bindDropzone, fileToBase64, readFileText } = window.App;

    // 载入已保存简历
    root.querySelector('#pm-load-saved').addEventListener('click', async () => {
      try {
        const r = await API.get('/profile/resume');
        if (!r.text) return toast('还没有保存过简历', 'err');
        this.state.text = r.text;
        this.state.saved = true;
        this.refresh(root);
        toast('已载入保存的简历', 'ok');
      } catch (err) { toast(err.message, 'err'); }
    });

    // 上传文件（点击：页面内真实隐藏 input，兼容内嵌浏览器；拖拽：drop 事件）
    const dz = root.querySelector('#pm-dropzone');
    const fileInput = root.querySelector('#pm-file');
    const handleFile = async (file) => {
      if (!file) return;
      try {
        let txt = '';
        if (/\.(txt|md|csv)$/i.test(file.name)) {
          txt = await readFileText(file);
          toast(`已读取 ${file.name}（${txt.length} 字）`, 'ok');
        } else {
          toast(`正在解析 ${file.name}…`, 'info');
          const b64 = await fileToBase64(file);
          const r = await API.post('/profile/resume', { raw_files: [{ name: file.name, base64: b64 }] });
          toast(`已解析并保存 ${file.name}（${r.chars} 字）`, 'ok');
          const got = await API.get('/profile/resume');
          txt = got.text;
        }
        this.state.text = txt; this.state.saved = true;
        this.refresh(root);
      } catch (err) { toast(err.message, 'err'); }
    };
    dz.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', () => {
      const f = fileInput.files && fileInput.files[0];
      fileInput.value = '';
      handleFile(f);
    });
    dz.addEventListener('dragover', (e) => { e.preventDefault(); dz.classList.add('over'); });
    dz.addEventListener('dragleave', () => dz.classList.remove('over'));
    dz.addEventListener('drop', (e) => { e.preventDefault(); dz.classList.remove('over'); handleFile(e.dataTransfer.files && e.dataTransfer.files[0]); });

    // 文本框输入
    root.querySelector('#pm-text').addEventListener('input', (e) => { this.state.text = e.target.value; });

    // 保存
    root.querySelector('#pm-save').addEventListener('click', async () => {
      if (!this.state.text.trim()) return toast('请先填写简历内容', 'err');
      try {
        await API.post('/profile/resume', { text: this.state.text });
        this.state.saved = true;
        toast('简历已保存 ✅', 'ok');
        this.refresh(root);
      } catch (err) { toast(err.message, 'err'); }
    });

    // 生成行业画像
    root.querySelector('#pm-match').addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true; btn.textContent = '分析中…';
      try {
        const r = await API.post('/profile/industry-match', { text: this.state.text.trim() || undefined });
        this.state.industries = r.industries || [];
        this.state.selected = [];
        toast(`生成完成：匹配到 ${this.state.industries.length} 个行业`, 'ok');
        this.refresh(root);
      } catch (err) { toast(err.message, 'err'); }
      btn.disabled = false; btn.textContent = '🔍 生成我的行业画像';
    });

    // 勾选行业
    root.querySelector('#pm-result').addEventListener('change', (e) => {
      if (e.target.type !== 'checkbox' || !e.target.dataset.ind) return;
      const ind = e.target.dataset.ind;
      this.state.selected = e.target.checked
        ? Array.from(new Set([...this.state.selected, ind]))
        : this.state.selected.filter((x) => x !== ind);
      const card = e.target.closest('.match-card');
      if (card) card.classList.toggle('on', this.state.selected.includes(ind));
      const go = root.querySelector('#pm-go-radar');
      const bp = root.querySelector('#pm-batch-plan');
      if (go) { go.disabled = !this.state.selected.length; go.textContent = `在岗位雷达中筛选 (${this.state.selected.length})`; }
      if (bp) { bp.disabled = !this.state.selected.length; bp.textContent = `⏳ 一键待投递 (${this.state.selected.length})`; }
    });

    // 单个行业一键待投递 / 去筛选
    root.querySelector('#pm-result').addEventListener('click', async (e) => {
      const addBtn = e.target.closest('[data-batch-add]');
      if (addBtn) {
        const ind = addBtn.dataset.batchAdd;
        addBtn.disabled = true; addBtn.textContent = '加入中…';
        try {
          const r = await API.post('/applications/batch', { industries: [ind] });
          toast(`已将 ${r.inserted} 个「${ind}」岗位加入投递计划${r.skipped ? `（${r.skipped} 个已在计划中）` : ''} 🎯`, 'ok');
        } catch (err) { toast(err.message, 'err'); }
        addBtn.disabled = false; addBtn.textContent = '⏳ 待投递';
        return;
      }
      const go = e.target.closest('[data-go]');
      if (!go) return;
      localStorage.setItem('qiuzhao_match_industry', JSON.stringify([go.dataset.go]));
      location.hash = '#/radar';
    });

    // 多选行业一键待投递
    root.querySelector('#pm-batch-plan').addEventListener('click', async () => {
      if (!this.state.selected.length) return toast('请先勾选行业', 'err');
      const btn = root.querySelector('#pm-batch-plan');
      btn.disabled = true; const old = btn.textContent;
      try {
        const r = await API.post('/applications/batch', { industries: this.state.selected });
        toast(`已将 ${r.inserted} 个岗位加入投递计划${r.skipped ? `（${r.skipped} 个已在计划中）` : ''} 🎯`, 'ok');
      } catch (err) { toast(err.message, 'err'); }
      btn.disabled = false; btn.textContent = old;
    });

    // 多选行业去雷达
    root.querySelector('#pm-go-radar').addEventListener('click', () => {
      if (!this.state.selected.length) return toast('请先勾选行业', 'err');
      localStorage.setItem('qiuzhao_match_industry', JSON.stringify(this.state.selected));
      location.hash = '#/radar';
    });
  },

  async refresh(root) {
    const pageRoot = document.getElementById('page-root');
    pageRoot.innerHTML = '<div class="loading-box"><div class="spinner"></div></div>';
    const html = await this.render();
    pageRoot.innerHTML = html;
    await this.init(pageRoot);
  },
};
