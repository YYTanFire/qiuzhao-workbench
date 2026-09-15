'use strict';
/**
 * 模块 6：知识库
 */
const Knowledge = {
  state: { keyword: '', industry: '', company: '', module: '' },

  async render() {
    const { esc } = window.App;
    const q = new URLSearchParams();
    Object.entries(this.state).forEach(([k, v]) => { if (v) q.set(k, v); });
    const d = await API.get('/knowledge?' + q.toString());
    const facets = d.facets || {};
    const sel = (name, items, placeholder) => `<select class="status-select" data-kf="${name}"><option value="">${placeholder}</option>${(items || []).map((x) => `<option value="${esc(x)}" ${this.state[name] === x ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select>`;

    const docs = d.items.map((k) => `
      <div class="kb-doc" data-kd="${k.id}">
        <div class="between">
          <div class="kb-title">${esc(k.title)}</div>
          <span class="pill ${k.doc_type === 'manual' ? 'pill-navy' : k.doc_type === 'image' ? 'pill-sky' : 'pill-gray'}">${({ manual: '手动', text: '文本', link: '链接', image: '图片OCR', docx: 'Word', pdf: 'PDF', txt: 'TXT' })[k.doc_type] || esc(k.doc_type)}</span>
        </div>
        <div class="kb-meta">
          ${k.industry ? `<span>${esc(k.industry)}</span>` : ''}${k.company ? `<span>${esc(k.company)}</span>` : ''}${k.module ? `<span>${esc(k.module)}</span>` : ''}
          <span>${esc(String(k.created_at).slice(5, 16).replace('T', ' '))}</span>
        </div>
        <div class="kb-excerpt">${esc(String(k.source || '').slice(0, 120))}</div>
      </div>`).join('') || window.App.emptyBox('知识库还是空的，录入第一篇资料吧', '◫');

    return `
      <div class="stack">
        <div class="ask-box">
          <div class="row" style="gap:10px">
            <div style="flex:1"><input type="text" id="ask-input" placeholder="直接向 AI 提问，自动调取知识库内容回答，例如：技术面试有哪些高频题？" style="width:100%;padding:11px 14px;border:1px solid var(--line);border-radius:10px;outline:none" /></div>
            <button class="btn btn-primary" id="ask-btn">提问</button>
          </div>
          <div id="ask-thread" class="qa-thread mt12"></div>
        </div>

        <div class="card card-pad">
          <div class="between wrap">
            <div class="row wrap" style="gap:10px">
              <input type="text" placeholder="🔍 关键词搜索" value="${esc(this.state.keyword)}" data-kf="keyword" style="min-width:180px;padding:8px 11px;border:1px solid var(--line);border-radius:9px;outline:none" />
              ${sel('industry', facets.industry, '行业')}
              ${sel('company', facets.company, '公司')}
              ${sel('module', facets.module, '模块')}
            </div>
            <button class="btn btn-primary" id="import-btn">＋ 录入资料</button>
          </div>
        </div>

        <div class="grid g-3">${docs}</div>
      </div>`;
  },

  async init(root) {
    const { toast, esc, openModal, closeModal, confirmDialog, fileToBase64, imageToDataUrl, bindDropzone, spinner } = window.App;
    const refresh = async () => { const pr = document.getElementById('page-root'); pr.innerHTML = '<div class="loading-box"><div class="spinner"></div></div>'; const html = await this.render(); pr.innerHTML = html; await this.init(pr); };

    root.querySelectorAll('[data-kf]').forEach((el) => {
      const apply = () => { this.state[el.dataset.kf] = el.value || ''; refresh(); };
      if (el.dataset.kf === 'keyword') {
        let t = null;
        el.addEventListener('input', () => { clearTimeout(t); t = setTimeout(apply, 400); });
      } else el.addEventListener('change', apply);
    });

    // AI 问答
    root.querySelector('#ask-btn').addEventListener('click', ask);
    root.querySelector('#ask-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') ask(); });
    async function ask() {
      const q = root.querySelector('#ask-input').value.trim();
      if (!q) return toast('请输入问题', 'err');
      const thread = root.querySelector('#ask-thread');
      thread.insertAdjacentHTML('beforeend', `<div class="q-line">Q：${esc(q)}</div><div class="a-line">${spinner()}</div>`);
      root.querySelector('#ask-input').value = '';
      try {
        const r = await API.post('/knowledge/ask', { question: q });
        const last = thread.querySelector('.a-line:last-child');
        if (last) {
          last.innerHTML = esc(r.answer) + (r.sources && r.sources.length ? `<div class="small muted mt8">参考：${r.sources.map((s) => esc(s)).join(' · ')}</div>` : '');
        }
      } catch (err) {
        const last = thread.querySelector('.a-line:last-child');
        if (last) last.innerHTML = `<span class="small muted">${esc(err.message)}</span>`;
      }
    }

    // 文档详情
    root.querySelectorAll('[data-kd]').forEach((el) => el.addEventListener('click', async () => {
      const k = await API.get('/knowledge/' + el.dataset.kd);
      const mask = openModal(`
        <div class="modal-head"><h3>${esc(k.title)}</h3><button class="modal-close" data-close>×</button></div>
        <div class="modal-body">
          <div class="row wrap" style="gap:8px">
            ${[['类型', ({ manual: '手动', text: '文本', link: '链接', image: '图片OCR', docx: 'Word', pdf: 'PDF', txt: 'TXT' })[k.doc_type] || k.doc_type], ['行业', k.industry], ['公司', k.company], ['模块', k.module], ['来源', k.source]].filter(([, v]) => v).map(([l, v]) => `<span class="tag">${l}：${esc(v)}</span>`).join('')}
          </div>
          <div class="resume-preview mt12" style="max-height:48vh;overflow:auto">${esc(k.content || '')}</div>
        </div>
        <div class="modal-foot"><button class="btn" data-close>关闭</button><button class="btn btn-danger" id="k-del">删除</button></div>`);
      mask.querySelector('[data-close]').addEventListener('click', () => closeModal(mask));
      mask.querySelector('#k-del').addEventListener('click', () => {
        confirmDialog('确定删除这份资料吗？', async () => {
          try { await API.del('/knowledge/' + k.id); toast('已删除', 'ok'); closeModal(mask); refresh(); }
          catch (err) { toast(err.message, 'err'); }
        });
      });
    }));

    // 录入
    root.querySelector('#import-btn').addEventListener('click', () => {
      let fileData = null, imageData = null;
      const mask = openModal(`
        <div class="modal-head"><h3>录入知识库资料</h3><button class="modal-close" data-close>×</button></div>
        <div class="modal-body">
          <div class="auth-tabs" style="margin-bottom:14px">
            <button class="on" data-tab="text">文本</button>
            <button data-tab="file">文件</button>
            <button data-tab="link">链接</button>
            <button data-tab="image">图片 OCR</button>
          </div>
          <div id="kb-tab-text">
            <div class="field"><label>标题</label><input id="k-title" placeholder="例如：XX 公司技术面经" /></div>
            <div class="field"><label>内容</label><textarea id="k-content" style="min-height:140px" placeholder="粘贴笔记、面经、资料全文…"></textarea></div>
          </div>
          <div id="kb-tab-file" style="display:none">
            <div class="field"><label>上传 Word / PDF / TXT</label>
              <div class="dropzone" id="k-file-drop">点击或拖拽上传 <b>.docx / .pdf / .txt</b><div class="fname" id="k-file-name"></div></div>
            </div>
            <div class="field"><label>标题（留空自动取文件名）</label><input id="k-title" /></div>
          </div>
          <div id="kb-tab-link" style="display:none">
            <div class="field"><label>网页链接</label><input id="k-link" placeholder="https://…（自动提取网页正文）" /></div>
            <div class="field"><label>标题（留空自动取网页标题）</label><input id="k-title" /></div>
          </div>
          <div id="kb-tab-image" style="display:none">
            <div class="field"><label>图片资料（OCR 识别文字，需配置视觉模型 API）</label>
              <div class="dropzone" id="k-img-drop">点击或拖拽上传图片<div class="fname" id="k-img-name"></div></div>
            </div>
            <div class="field"><label>标题（留空自动命名）</label><input id="k-title" /></div>
          </div>
          <div class="row" style="gap:12px">
            <div class="field" style="flex:1"><label>行业</label><input id="k-industry" placeholder="例如：互联网" /></div>
            <div class="field" style="flex:1"><label>公司</label><input id="k-company" placeholder="例如：星舟网络（可空）" /></div>
            <div class="field" style="flex:1"><label>模块分类</label><input id="k-module" placeholder="例如：面试准备" /></div>
          </div>
        </div>
        <div class="modal-foot"><button class="btn" data-close>取消</button><button class="btn btn-primary" id="save-kb">保存</button></div>`);
      mask.querySelector('[data-close]').addEventListener('click', () => closeModal(mask));
      let tab = 'text';
      mask.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => {
        tab = b.dataset.tab;
        mask.querySelectorAll('[data-tab]').forEach((x) => x.classList.toggle('on', x === b));
        ['text', 'file', 'link', 'image'].forEach((t) => { mask.querySelector('#kb-tab-' + t).style.display = t === tab ? 'block' : 'none'; });
      }));

      bindDropzone(mask.querySelector('#k-file-drop'), async (f) => {
        if (!f) return;
        if (!/\.(docx|pdf|txt|md)$/i.test(f.name)) return toast('仅支持 .docx / .pdf / .txt', 'err');
        fileData = { name: f.name, base64: await fileToBase64(f) };
        mask.querySelector('#k-file-name').textContent = '✓ ' + f.name;
      });
      bindDropzone(mask.querySelector('#k-img-drop'), async (f) => {
        if (!f) return;
        if (!/\.(png|jpe?g|webp)$/i.test(f.name)) return toast('请选择图片文件', 'err');
        imageData = await imageToDataUrl(f);
        mask.querySelector('#k-img-name').textContent = '✓ ' + f.name;
      });

      mask.querySelector('#save-kb').addEventListener('click', async () => {
        const title = mask.querySelector('#k-title') ? mask.querySelector('#k-title').value.trim() : '';
        const common = { title, industry: mask.querySelector('#k-industry').value.trim(), company: mask.querySelector('#k-company').value.trim(), module: mask.querySelector('#k-module').value.trim() };
        const btn = mask.querySelector('#save-kb');
        btn.disabled = true; btn.textContent = '保存中…';
        try {
          if (tab === 'text') {
            if (!common.title) return toast('请填写标题', 'err');
            await API.post('/knowledge', { ...common, content: mask.querySelector('#k-content').value });
          } else if (tab === 'file') {
            if (!fileData) return toast('请先选择文件', 'err');
            await API.post('/knowledge/import', { type: 'file', raw_file: fileData, ...common });
          } else if (tab === 'link') {
            const url = mask.querySelector('#k-link').value.trim();
            if (!url) return toast('请填写链接', 'err');
            await API.post('/knowledge/import', { type: 'link', link_url: url, ...common });
          } else if (tab === 'image') {
            if (!imageData) return toast('请先选择图片', 'err');
            await API.post('/knowledge/import', { type: 'image', image_data_url: imageData, ...common });
          }
          toast('资料已录入知识库', 'ok');
          closeModal(mask);
          refresh();
        } catch (err) { toast(err.message, 'err'); }
        btn.disabled = false; btn.textContent = '保存';
      });
    });
  },
};
