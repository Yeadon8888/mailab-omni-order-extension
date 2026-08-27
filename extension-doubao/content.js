(() => {
  if (window.__mailabGenVideoFloatInstalled) return;
  window.__mailabGenVideoFloatInstalled = true;

  const STORAGE_KEY = 'mailab_public_order_settings';
  const POSITION_KEY = 'mailab_public_order_position';
  const ACTIVE_ORDER_KEY = 'mailab_public_active_order';
  const DEFAULT_SERVER_URL = 'https://genvideo.mailab.top';
  const iconUrl = chrome.runtime.getURL('icons/icon48.png');

  const host = document.createElement('div');
  host.id = 'mailab-gen-video-host';
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = `
    <style>
      * { box-sizing: border-box; }
      [hidden] { display: none !important; }
      :host { all: initial; }
      .launcher {
        position: fixed;
        right: 20px;
        bottom: 24px;
        z-index: 2147483647;
        width: 62px;
        height: 62px;
        border: 0;
        border-radius: 18px;
        background: linear-gradient(135deg, #0b1220, #123b3a);
        box-shadow: 0 18px 44px rgba(15,23,42,.28);
        cursor: pointer;
        display: none;
        place-items: center;
      }
      .launcher img { width: 44px; height: 44px; border-radius: 12px; }
      .panel {
        position: fixed;
        right: 22px;
        top: 118px;
        z-index: 2147483647;
        width: 460px;
        max-width: calc(100vw - 28px);
        max-height: calc(100vh - 136px);
        overflow: hidden;
        border: 1px solid rgba(16,32,29,.12);
        border-radius: 16px;
        background: #edf4f2;
        color: #10201d;
        box-shadow: 0 24px 70px rgba(15,23,42,.26);
        font: 13px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Arial,"Microsoft YaHei",sans-serif;
      }
      .panel.is-hidden { display: none; }
      .toast {
        position: absolute;
        left: 14px;
        right: 14px;
        top: 14px;
        z-index: 3;
        border: 1px solid rgba(18,155,114,.28);
        border-radius: 14px;
        background: #ecfdf5;
        color: #064e3b;
        padding: 14px;
        box-shadow: 0 18px 44px rgba(15,23,42,.26);
        font-size: 14px;
        font-weight: 950;
        line-height: 1.45;
        white-space: pre-wrap;
        word-break: break-word;
      }
      .toast[hidden] { display: none; }
      .toast.is-error { border-color: rgba(220,38,38,.36); background: #fef2f2; color: #991b1b; }
      .toast.is-warn { border-color: rgba(217,119,6,.34); background: #fffbeb; color: #92400e; }
      .brand {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        min-height: 72px;
        padding: 12px 12px 12px 14px;
        background:
          radial-gradient(circle at 82% 10%, rgba(223,255,63,.28), transparent 30%),
          linear-gradient(135deg, #0b1220, #123b3a 58%, #0f172a);
        color: #eafff4;
        cursor: move;
        user-select: none;
      }
      .brand-main { display: flex; align-items: center; gap: 11px; min-width: 0; }
      .brand img { width: 46px; height: 46px; border-radius: 13px; box-shadow: 0 10px 26px rgba(0,0,0,.24); }
      .brand h1 { margin: 0; color: #dfff3f; font-size: 17px; line-height: 1.1; letter-spacing: 0; }
      .brand p { margin: 3px 0 0; color: #bce7d4; font-size: 12px; font-weight: 800; }
      .icon-button {
        width: 32px;
        height: 32px;
        border: 0;
        border-radius: 10px;
        background: rgba(255,255,255,.12);
        color: #fff;
        font-size: 22px;
        line-height: 30px;
        cursor: pointer;
      }
      .body {
        display: grid;
        gap: 12px;
        max-height: calc(100vh - 208px);
        overflow: auto;
        padding: 12px;
      }
      .card {
        display: grid;
        gap: 11px;
        border: 1px solid rgba(16,32,29,.08);
        border-radius: 14px;
        background: #fff;
        padding: 12px;
        box-shadow: 0 8px 24px rgba(15,23,42,.08);
      }
      label, .material-card { display: grid; gap: 7px; min-width: 0; }
      .material-card {
        display: flex;
        flex-direction: column;
        align-items: stretch;
      }
      label span, .material-card span, .task-head strong { color: #27423c; font-size: 12px; font-weight: 900; }
      input, textarea {
        width: 100%;
        border: 1px solid #cfdcd8;
        border-radius: 11px;
        background: #fbfefd;
        color: #10201d;
        outline: none;
        padding: 10px 11px;
        font: inherit;
      }
      textarea { resize: vertical; }
      input:focus, textarea:focus { border-color: #129b72; box-shadow: 0 0 0 3px rgba(18,155,114,.15); }
      button {
        border: 0;
        cursor: pointer;
        font: inherit;
      }
      button:disabled { cursor: not-allowed; opacity: .56; }
      .claim-row { display: grid; grid-template-columns: minmax(0,1fr) 94px 94px; gap: 9px; align-items: end; }
      .primary {
        min-height: 42px;
        border-radius: 12px;
        background: linear-gradient(135deg, #129b72, #0f766e);
        color: #fff;
        font-weight: 950;
      }
      .status {
        min-height: 34px;
        border: 1px solid #e0ece8;
        border-radius: 11px;
        background: #f6fbf9;
        color: #53706a;
        padding: 8px 10px;
        font-size: 12px;
        word-break: break-word;
      }
      .pool-status {
        display: grid;
        grid-template-columns: 1fr auto;
        align-items: center;
        gap: 10px;
        border: 1px solid #b8ddd2;
        border-radius: 12px;
        background: #effcf8;
        padding: 10px 11px;
      }
      .pool-status strong {
        color: #10201d;
        font-size: 13px;
      }
      .pool-status span {
        color: #53706a;
        font-size: 12px;
        font-weight: 800;
      }
      .pool-status b {
        color: #0f766e;
        font-size: 20px;
        line-height: 1;
      }
      .pool-actions {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        flex: 0 0 auto;
      }
      .pool-refresh {
        min-width: 52px;
        min-height: 30px;
        border-radius: 9px;
        background: #10201d;
        color: #eafff4;
        font-size: 12px;
        font-weight: 950;
        white-space: nowrap;
      }
      .pool-refresh:hover:not(:disabled) {
        background: #0f766e;
      }
      .task-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; }
      .task-head > div:first-child { display: grid; gap: 3px; min-width: 0; }
      #taskMeta {
        max-width: 185px;
        color: #66827c;
        font-size: 12px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .copy-actions { display: grid; grid-template-columns: 1fr 1fr; gap: 7px; flex: 0 0 184px; }
      .copy-actions button, .secondary {
        min-height: 34px;
        border-radius: 10px;
        background: #14231f;
        color: #eafff4;
        font-size: 12px;
        font-weight: 900;
      }
      .secondary {
        width: 100%;
        border: 1px solid rgba(15,35,31,.18);
        background: #fff;
        color: #31524b;
      }
      .danger {
        min-height: 42px;
        border-radius: 12px;
        background: linear-gradient(135deg, #ef4444, #b91c1c);
        color: #fff;
        font-weight: 950;
      }
      .finish-row {
        display: grid;
        grid-template-columns: minmax(0, 1fr) 126px;
        gap: 8px;
        align-items: end;
        border: 1px solid #dbe7e3;
        border-radius: 12px;
        background: #f7fbfa;
        padding: 9px;
      }
      .finish-row label { gap: 5px; }
      .finish-row textarea {
        min-height: 50px;
        height: 50px;
        resize: vertical;
      }
      .finish-row .primary {
        min-height: 50px;
        align-self: end;
      }
      .material-grid {
        display: grid;
        grid-template-columns: minmax(0,1fr) 174px;
        gap: 11px;
        align-items: stretch;
      }
      #promptText {
        flex: 1 1 auto;
        min-height: 230px;
        height: 230px;
        align-self: stretch;
      }
      .image-frame {
        display: grid;
        place-items: center;
        flex: 1 1 auto;
        min-height: 230px;
        height: 230px;
        border: 1px solid #dbe7e3;
        border-radius: 12px;
        background: #f7fbfa;
        overflow: hidden;
        padding: 8px;
      }
      .image-frame img { display: block; width: 100%; height: 100%; max-height: 214px; object-fit: scale-down; border-radius: 9px; background: #fff; }
      .empty { display: grid; place-items: center; width: 100%; min-height: 210px; border-radius: 9px; color: #8aa39d; background: #fff; font-weight: 900; }
      #watermarkInput { min-height: 68px; }
      .test-mode { display: flex; align-items: center; gap: 8px; color: #53706a; font-size: 12px; font-weight: 800; }
      .test-mode input { width: 16px; height: 16px; margin: 0; accent-color: #129b72; flex: 0 0 auto; }
      .result {
        border: 1px solid #b8ddd2;
        border-radius: 12px;
        background: #effcf8;
        color: #10201d;
        padding: 11px;
        font-size: 12px;
        word-break: break-all;
      }
      .result[hidden] { display: none; }
      .result a {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-height: 30px;
        margin-top: 8px;
        margin-right: 8px;
        padding: 0 10px;
        border-radius: 9px;
        background: #129b72;
        color: #fff;
        text-decoration: none;
        font-weight: 900;
      }
      .capture-list { display: grid; gap: 8px; }
      .capture-empty {
        border: 1px solid #e0ece8;
        border-radius: 11px;
        background: #f6fbf9;
        color: #66827c;
        padding: 10px;
        font-size: 12px;
        text-align: center;
      }
      .capture-item {
        display: grid;
        grid-template-columns: 1fr auto;
        gap: 8px;
        align-items: center;
        border: 1px solid #dbe7e3;
        border-radius: 11px;
        background: #fbfefd;
        padding: 8px;
      }
      .capture-label {
        min-width: 0;
        color: #27423c;
        font-size: 12px;
        font-weight: 900;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .capture-label span {
        display: inline-flex;
        align-items: center;
        min-height: 20px;
        margin-right: 7px;
        padding: 0 7px;
        border-radius: 999px;
        background: #0f766e;
        color: #fff;
        font-size: 11px;
      }
      .capture-label span.video { background: #6d28d9; }
      .capture-actions, .capture-tools { display: flex; gap: 6px; }
      .capture-actions button, .capture-refresh {
        min-height: 30px;
        border-radius: 9px;
        background: #14231f;
        color: #eafff4;
        padding: 0 9px;
        font-size: 12px;
        font-weight: 900;
      }
      .capture-refresh {
        padding: 0 10px;
        background: #fff;
        color: #31524b;
        border: 1px solid rgba(15,35,31,.18);
      }
      .capture-tools { flex-wrap: wrap; justify-content: flex-end; }
      @media (max-width: 520px) {
        .panel { left: 10px !important; right: auto; width: calc(100vw - 20px); }
        .claim-row, .material-grid, .task-head, .finish-row { display: grid; grid-template-columns: 1fr; }
        .copy-actions { width: 100%; flex-basis: auto; grid-template-columns: 1fr 1fr; }
        .capture-item { grid-template-columns: 1fr; }
        .capture-actions { flex-wrap: wrap; }
        #promptText, .image-frame { height: 190px; min-height: 190px; }
        .empty { min-height: 170px; }
      }
    </style>
    <button class="launcher" type="button" title="打开 MAILAB"><img src="${iconUrl}" alt=""></button>
    <section class="panel">
      <div id="toast" class="toast" hidden></div>
      <header class="brand" id="dragHandle">
        <div class="brand-main">
          <img src="${iconUrl}" alt="">
          <div>
            <h1>MAILAB GEN VIDEO</h1>
            <p>公网接单工作台</p>
          </div>
        </div>
        <button class="icon-button" id="hideButton" type="button" title="收起">×</button>
      </header>
      <div class="body">
        <section class="card">
          <div class="pool-status">
            <div>
              <strong>任务池</strong>
              <span id="poolDetail">正在读取待接单数量...</span>
            </div>
            <div class="pool-actions">
              <b id="pendingCount">--</b>
              <button id="refreshStatsButton" class="pool-refresh" type="button" title="刷新任务池状态">刷新</button>
            </div>
          </div>
          <div class="claim-row">
            <label><span>接单人</span><input id="assigneeInput" type="text" placeholder="请输入你的名字"></label>
            <button id="claimButton" class="primary" type="button">接单</button>
            <button id="releaseButton" class="danger" type="button">释放任务</button>
          </div>
          <div id="status" class="status">填写接单人，然后点击接单。</div>
        </section>
        <section class="card">
          <div class="task-head">
            <div><strong>当前任务</strong><span id="taskMeta">未接单</span></div>
            <div class="copy-actions">
              <button id="copyPromptButton" type="button" disabled>复制提示词</button>
              <button id="copyImageButton" type="button" disabled>复制图片</button>
            </div>
          </div>
          <div class="capture-panel">
            <div class="task-head">
              <div><strong>页面捕获资源</strong><span id="captureMeta">等待豆包/Dola 生成结果</span></div>
              <div class="capture-tools">
                <button id="clearCaptureButton" class="capture-refresh" type="button">清空</button>
              </div>
            </div>
            <div id="captureList" class="capture-list">
              <div class="capture-empty">打开豆包或 Dola 页面后会自动捕获无水印资源</div>
            </div>
          </div>
          <div class="material-grid">
            <label class="material-card"><span>提示词</span><textarea id="promptText" readonly placeholder="接单后同步提示词"></textarea></label>
            <div class="material-card"><span>图片预览</span><div class="image-frame"><div id="imageEmpty" class="empty">接单后显示图片</div><img id="taskImage" alt="" decoding="async" loading="eager" hidden></div></div>
          </div>
          <div class="finish-row">
            <label><span>豆包分享链接或视频直链</span><textarea id="watermarkInput" placeholder="粘贴 https://www.doubao.com/thread/... 或最终 MP4 链接"></textarea></label>
            <button id="completeButton" class="primary" type="button" disabled>同步完成</button>
          </div>
          <div id="result" class="result" hidden></div>
        </section>
      </div>
    </section>
  `;
  document.documentElement.appendChild(host);

  const $ = (selector) => shadow.querySelector(selector);
  const els = {
    launcher: $('.launcher'),
    panel: $('.panel'),
    dragHandle: $('#dragHandle'),
    hideButton: $('#hideButton'),
    toast: $('#toast'),
    assigneeInput: $('#assigneeInput'),
    claimButton: $('#claimButton'),
    refreshStatsButton: $('#refreshStatsButton'),
    pendingCount: $('#pendingCount'),
    poolDetail: $('#poolDetail'),
    status: $('#status'),
    taskMeta: $('#taskMeta'),
    copyPromptButton: $('#copyPromptButton'),
    copyImageButton: $('#copyImageButton'),
    releaseButton: $('#releaseButton'),
    promptText: $('#promptText'),
    imageEmpty: $('#imageEmpty'),
    taskImage: $('#taskImage'),
    watermarkInput: $('#watermarkInput'),
    completeButton: $('#completeButton'),
    result: $('#result'),
    captureMeta: $('#captureMeta'),
    captureList: $('#captureList'),
    clearCaptureButton: $('#clearCaptureButton')
  };

  const state = {
    settings: { serverUrl: DEFAULT_SERVER_URL, assignee: '' },
    order: null,
    imageLoadToken: 0,
    capturedItems: new Map(),
    captureStatus: '接单后开始捕获本任务资源',
    captureArmedAt: 0
  };

  els.launcher.addEventListener('click', () => setPanelOpen(true));
  els.hideButton.addEventListener('click', () => setPanelOpen(false));
  els.claimButton.addEventListener('click', claimOrder);
  els.refreshStatsButton.addEventListener('click', () => loadStats({ manual: true }));
  els.copyPromptButton.addEventListener('click', copyPrompt);
  els.copyImageButton.addEventListener('click', copyImage);
  els.releaseButton.addEventListener('click', releaseOrder);
  els.completeButton.addEventListener('click', completeOrder);
  els.clearCaptureButton.addEventListener('click', clearCapturedItems);
  els.assigneeInput.addEventListener('change', saveSettings);
  chrome.runtime.onMessage.addListener((message) => {
    if (!message) return;
    if (message.type === 'MEDIA_STATUS' && typeof message.text === 'string') {
      applyCaptureStatus(message);
      return;
    }
    if (message.type === 'MEDIA_FOUND' && Array.isArray(message.items)) {
      applyCapturedSnapshot(message);
    }
  });
  installDrag();
  loadSettings();
  loadPosition();
  renderOrder();
  setTimeout(loadStats, 300);
  renderCapturedItems();

  function loadSettings() {
    chrome.storage.local.get({ [STORAGE_KEY]: {}, [ACTIVE_ORDER_KEY]: null }, (items) => {
      const settings = items[STORAGE_KEY] || {};
      state.settings.serverUrl = DEFAULT_SERVER_URL;
      state.settings.assignee = String(settings.assignee || '').trim();
      state.order = normalizeStoredOrder(items[ACTIVE_ORDER_KEY]);
      state.captureArmedAt = state.order ? Date.now() : 0;
      els.assigneeInput.value = state.settings.assignee;
      renderOrder();
      if (state.order) {
        setStatus('已恢复上次未完成的接单任务。', 'success', { duration: 5000 });
      }
      loadStats();
    });
  }

  function saveSettings() {
    state.settings.serverUrl = DEFAULT_SERVER_URL;
    state.settings.assignee = String(els.assigneeInput.value || '').trim();
    chrome.storage.local.set({ [STORAGE_KEY]: { ...state.settings } });
    return state.settings;
  }

  function loadPosition() {
    chrome.storage.local.get({ [POSITION_KEY]: null }, (items) => {
      const pos = items[POSITION_KEY];
      if (!pos || !Number.isFinite(pos.left) || !Number.isFinite(pos.top)) return;
      movePanel(clamp(pos.left, 8, window.innerWidth - 80), clamp(pos.top, 8, window.innerHeight - 80));
    });
  }

  function setPanelOpen(open) {
    els.panel.classList.toggle('is-hidden', !open);
    els.launcher.style.display = open ? 'none' : 'grid';
  }

  function installDrag() {
    let dragging = false;
    let offsetX = 0;
    let offsetY = 0;
    els.dragHandle.addEventListener('pointerdown', (event) => {
      if (event.target === els.hideButton) return;
      dragging = true;
      const rect = els.panel.getBoundingClientRect();
      offsetX = event.clientX - rect.left;
      offsetY = event.clientY - rect.top;
      els.dragHandle.setPointerCapture?.(event.pointerId);
    });
    els.dragHandle.addEventListener('pointermove', (event) => {
      if (!dragging) return;
      event.preventDefault();
      const left = clamp(event.clientX - offsetX, 8, window.innerWidth - Math.min(80, els.panel.offsetWidth));
      const top = clamp(event.clientY - offsetY, 8, window.innerHeight - Math.min(80, els.panel.offsetHeight));
      movePanel(left, top);
    });
    els.dragHandle.addEventListener('pointerup', () => {
      if (!dragging) return;
      dragging = false;
      const rect = els.panel.getBoundingClientRect();
      chrome.storage.local.set({ [POSITION_KEY]: { left: rect.left, top: rect.top } });
    });
  }

  function movePanel(left, top) {
    els.panel.style.left = `${left}px`;
    els.panel.style.top = `${top}px`;
    els.panel.style.right = 'auto';
  }

  async function armTaskCapture() {
    state.captureArmedAt = Date.now();
    state.capturedItems.clear();
    state.captureStatus = '已进入本任务捕获模式，请现在生成视频';
    renderCapturedItems();
    await sendMessage({ type: 'CAPTURE_CLEAR_CURRENT' }).catch(() => null);
  }

  function disarmTaskCapture(statusText) {
    state.captureArmedAt = 0;
    state.capturedItems.clear();
    state.captureStatus = statusText || '接单后开始捕获本任务资源';
    renderCapturedItems();
  }

  async function claimOrder() {
    const settings = saveSettings();
    if (!settings.serverUrl) return setStatus('后端地址配置异常，请联系管理员。', 'error');
    if (!settings.assignee) return setStatus('请先填写接单人。', 'error');
    if (state.order?.recordId && state.order?.lockId) {
      setStatus('当前已有未完成任务，请先同步完成或释放任务。', 'warn', { duration: 7000 });
      renderOrder();
      return;
    }
    setBusy(els.claimButton, '接单中...', true);
    setStatus('正在接单...', 'warn');
    try {
      const data = await mailabApi('/api/claim', { assignee: settings.assignee, platform: '豆包' });
      if (!data.ok) return setStatus(data.error || '暂无可接任务。', 'error');
      state.order = data;
      armTaskCapture();
      saveActiveOrder();
      renderOrder();
      setStatus('接单成功，已清空旧捕获，只接收本任务之后的新视频。', 'success');
      loadStats();
    } catch (error) {
      setStatus(error.message || '接单失败', 'error');
    } finally {
      setBusy(els.claimButton, '接单', false);
    }
  }

  function renderOrder() {
    const order = state.order;
    if (!order) {
      els.taskMeta.textContent = '未接单';
      els.promptText.value = '';
      els.watermarkInput.value = '';
      els.taskImage.removeAttribute('src');
      els.taskImage.hidden = true;
      els.imageEmpty.hidden = false;
      els.copyPromptButton.disabled = true;
      els.copyImageButton.disabled = true;
      els.releaseButton.disabled = false;
      els.completeButton.disabled = true;
      if (!state.captureArmedAt) {
        state.capturedItems.clear();
        state.captureStatus = '接单后开始捕获本任务资源';
        renderCapturedItems();
      }
      return;
    }
    els.taskMeta.textContent = `接单人：${order.assignee || state.settings.assignee} | 记录：${order.recordId || ''}`;
    els.promptText.value = order.prompt || '';
    const imageUrl = normalizeHttpUrl(order.imageUrl || '');
    els.copyPromptButton.disabled = !order.prompt;
    els.copyImageButton.disabled = !imageUrl;
    els.releaseButton.disabled = false;
    els.completeButton.disabled = false;
    els.watermarkInput.value = '';
    clearResult();
    if (imageUrl) {
      els.imageEmpty.textContent = '接单后显示图片';
      els.taskImage.dataset.fallbackTried = '';
      els.taskImage.onerror = () => {
        if (!els.taskImage.dataset.fallbackTried) {
          els.taskImage.dataset.fallbackTried = '1';
          els.taskImage.src = imageUrl;
          return;
        }
        els.taskImage.hidden = true;
        els.imageEmpty.hidden = false;
        els.imageEmpty.textContent = '图片加载失败，可点击复制图片';
      };
      els.taskImage.src = previewImageUrl(imageUrl);
      els.taskImage.hidden = false;
      els.imageEmpty.hidden = true;
    } else {
      els.taskImage.removeAttribute('src');
      els.taskImage.hidden = true;
      els.imageEmpty.hidden = false;
    }
  }

  async function copyPrompt() {
    const prompt = state.order?.prompt || els.promptText.value || '';
    if (!prompt) return setStatus('没有提示词可复制。', 'error');
    try {
      await navigator.clipboard.writeText(prompt);
      setStatus('提示词已复制。', 'success');
    } catch {
      setStatus('复制提示词失败。', 'error');
    }
  }

  async function copyImage() {
    const imageUrl = normalizeHttpUrl(state.order?.imageUrl || '');
    if (!imageUrl) return setStatus('没有图片可复制。', 'error');
    try {
      const proxyUrl = proxyImageUrl(imageUrl);
      const response = await fetch(proxyUrl);
      if (!response.ok) throw new Error('图片读取失败');
      const blob = await response.blob();
      await navigator.clipboard.write([new ClipboardItem({ [blob.type || 'image/png']: blob })]);
      setStatus('图片已复制到剪贴板。', 'success');
    } catch (error) {
      try {
        await navigator.clipboard.writeText(imageUrl);
        setStatus('图片复制失败，已改为复制图片地址。', 'warn');
      } catch {
        setStatus(error.message || '复制图片失败。', 'error');
      }
    }
  }

  async function completeOrder() {
    const settings = saveSettings();
    if (!state.order?.recordId || !state.order?.lockId) return setStatus('请先接单。', 'error');
    const submittedUrl = normalizeHttpUrl(els.watermarkInput.value || '');
    if (!submittedUrl) {
      setResult('请输入有效的视频链接。');
      return setStatus('视频链接无效，请检查后再试。', 'error');
    }
    setBusy(els.completeButton, '处理中...', true);
    setResult('正在同步视频地址到飞书...');
    setStatus('正在同步视频地址...', 'warn', { duration: 5000 });
    try {
      const completion = await prepareCompletionUrl(submittedUrl);
      const data = await mailabApi('/api/complete', {
        recordId: state.order.recordId,
        lockId: state.order.lockId,
        assignee: settings.assignee,
        ...(completion.direct
          ? { videoUrl: completion.url, directComplete: true }
          : { watermarkUrl: completion.url })
      });
      if (!data.ok) {
        const errorText = data.error || '同步失败';
        setResult(data.videoUrl ? `${errorText}\n视频链接：` : errorText, data.videoUrl || '');
        setStatus(data.videoUrl ? `${errorText}\n视频链接：\n${data.videoUrl}` : errorText, 'error', { duration: data.videoUrl ? 14000 : 9000 });
        return;
      }
      setResult('已完成并同步飞书。', data.videoUrl || '');
      setStatus(data.videoUrl ? `任务已完成，视频地址已同步。\n${data.videoUrl}` : '任务已完成，视频地址已同步。', 'success', { duration: 12000 });
      state.order = null;
      disarmTaskCapture('任务已完成，接单后开始捕获下一条任务资源');
      clearActiveOrder();
      renderOrder();
      loadStats();
    } catch (error) {
      setResult(error.message || '同步失败，任务已回滚。');
      setStatus(error.message || '同步失败，任务已回滚。', 'error', { duration: 9000 });
    } finally {
      if (state.order) setBusy(els.completeButton, '同步完成', false);
      else els.completeButton.textContent = '同步完成';
    }
  }

  async function prepareCompletionUrl(url) {
    const doubaoUrl = normalizeDoubaoUrl(url);
    if (!doubaoUrl || !new URL(doubaoUrl).pathname.startsWith('/thread/')) {
      return { url, direct: true };
    }
    setResult('正在浏览器内解析豆包无水印视频...');
    setStatus('正在解析豆包分享链接...', 'warn', { duration: 6000 });
    const response = await sendMessage({ type: 'DOUBAO_RESOLVE_THREAD', url: doubaoUrl });
    const videoUrl = normalizeHttpUrl(response?.data?.videoUrl || '');
    if (response?.ok && videoUrl) {
      return { url: videoUrl, direct: true };
    }
    setStatus('浏览器解析失败，已改用后端去水印服务。', 'warn', { duration: 6000 });
    return { url: doubaoUrl, direct: false };
  }

  async function releaseOrder() {
    saveSettings();
    if (!state.order?.recordId || !state.order?.lockId) {
      clearActiveOrder();
      state.order = null;
      disarmTaskCapture('接单后开始捕获本任务资源');
      renderOrder();
      return setStatus('本地任务缓存已清除。', 'success');
    }
    setBusy(els.releaseButton, '释放中...', true);
    setStatus('正在释放当前任务...', 'warn', { duration: 5000 });
    try {
      const data = await mailabApi('/api/release', {
        recordId: state.order.recordId,
        lockId: state.order.lockId,
        reason: '用户在插件中释放任务'
      });
      if (!data.ok) {
        throw new Error(data.error || '释放任务失败');
      }
      state.order = null;
      disarmTaskCapture('任务已释放，接单后开始捕获下一条任务资源');
      clearActiveOrder();
      renderOrder();
      loadStats();
      setStatus('任务已释放，可以重新接单。', 'success');
    } catch (error) {
      state.order = null;
      disarmTaskCapture('任务已释放，接单后开始捕获下一条任务资源');
      clearActiveOrder();
      renderOrder();
      setStatus(`插件本地卡住状态已清除，但飞书释放失败：${error.message || '未知错误'}`, 'warn', { duration: 9000 });
    } finally {
      els.releaseButton.textContent = '释放任务';
    }
  }

  function renderCapturedItems() {
    els.captureMeta.textContent = state.capturedItems.size ? `已捕获 ${state.capturedItems.size} 个` : state.captureStatus;
    els.captureList.textContent = '';
    if (!state.capturedItems.size) {
      const empty = document.createElement('div');
      empty.className = 'capture-empty';
      empty.textContent = state.captureStatus || '等待捕获资源';
      els.captureList.appendChild(empty);
      return;
    }
    Array.from(state.capturedItems.values()).forEach((item, index) => {
      const row = document.createElement('div');
      row.className = 'capture-item';
      const label = document.createElement('div');
      label.className = 'capture-label';
      label.title = item.url;
      const tag = document.createElement('span');
      tag.className = item.type;
      tag.textContent = item.type === 'image' ? '图片' : (item.recommended ? '推荐视频' : '视频');
      label.append(tag, document.createTextNode(`${index + 1} ${shortUrl(item.url)}`));

      const actions = document.createElement('div');
      actions.className = 'capture-actions';
      actions.append(
        makeCaptureButton('复制', () => copyCapturedUrl(item)),
        makeCaptureButton('下载', () => downloadCapturedUrl(item))
      );
      if (item.type === 'video') {
        actions.append(makeCaptureButton(item.recommended ? '同步推荐' : '同步', () => syncCapturedVideo(item)));
      }
      row.append(label, actions);
      els.captureList.appendChild(row);
    });
  }

  async function refreshCapture(showNotice = true) {
    if (showNotice) {
      setStatus('正在读取当前页面捕获结果...', 'warn', { duration: 3500 });
    }
    try {
      const response = await sendMessage({ type: showNotice ? 'CAPTURE_REFRESH' : 'CAPTURE_GET_CURRENT' });
      if (!response?.ok || !response.data) {
        throw new Error(response?.error || '读取捕获结果失败');
      }
      if (response.data.type === 'MEDIA_FOUND') {
        applyCapturedSnapshot(response.data);
        if (showNotice) setStatus('已刷新当前页面捕获结果。', 'success');
      } else {
        applyCaptureStatus(response.data);
        if (showNotice) setStatus(response.data.text || '当前页面暂无捕获结果。', 'warn', { duration: 6000 });
      }
    } catch (error) {
      if (showNotice) setStatus(error.message || '刷新捕获失败', 'error');
    }
  }

  async function scanCurrentPageVideos() {
    setStatus('正在扫描当前页面视频...', 'warn', { duration: 3500 });
    const items = collectCurrentPageVideos();
    state.capturedItems.clear();
    for (const item of items) {
      state.capturedItems.set(item.url, item);
    }
    state.captureStatus = items.length
      ? `已扫描当前页 ${items.length} 个视频`
      : '当前页没有识别到可同步的视频直链';
    renderCapturedItems();
    setStatus(items.length ? '已只显示当前页面扫描到的视频。' : '没有扫描到当前页视频直链，可以生成后再试。', items.length ? 'success' : 'warn', { duration: 6000 });
  }

  async function clearCapturedItems() {
    state.capturedItems.clear();
    state.captureStatus = '已清空捕获记录，请生成后刷新或扫描当前页';
    renderCapturedItems();
    await sendMessage({ type: 'CAPTURE_CLEAR_CURRENT' }).catch(() => null);
    setStatus('已清空当前页面捕获记录。', 'success');
  }

  function applyCaptureStatus(message) {
    if (!state.order?.recordId || !state.captureArmedAt) {
      return;
    }
    if (!message.keepItems) {
      state.capturedItems.clear();
    }
    state.captureStatus = message.text || state.captureStatus;
    renderCapturedItems();
  }

  function applyCapturedSnapshot(message) {
    if (!shouldAcceptCapturedSnapshot(message)) {
      return;
    }
    state.capturedItems.clear();
    for (const item of message.items || []) {
      if (item?.url && /^https?:\/\//i.test(item.url)) {
        state.capturedItems.set(item.url, {
          type: item.type === 'image' ? 'image' : 'video',
          url: item.url,
          recommended: Boolean(item.recommended)
        });
      }
    }
    const suffix = message.fromCache ? '（缓存）' : '';
    state.captureStatus = state.capturedItems.size ? `已捕获资源${suffix}` : '未提取到资源';
    renderCapturedItems();
  }

  function shouldAcceptCapturedSnapshot(message) {
    if (!state.order?.recordId || !state.captureArmedAt) {
      return false;
    }
    if (message.fromCache) {
      return false;
    }
    const updatedAt = Number(message.updatedAt || Date.now());
    if (updatedAt + 500 < state.captureArmedAt) {
      return false;
    }
    return true;
  }

  function collectCurrentPageVideos() {
    const candidates = [];
    const seen = new Set();
    const add = (url, score = 0) => {
      const normalized = normalizeHttpUrl(url || '');
      if (!normalized || seen.has(normalized) || !looksLikeVideoUrl(normalized)) return;
      seen.add(normalized);
      candidates.push({ type: 'video', url: normalized, recommended: false, score });
    };

    document.querySelectorAll('video').forEach((video) => {
      const rect = video.getBoundingClientRect();
      const visibleScore = rect.width > 80 && rect.height > 80 ? 800 : 0;
      const activeScore = Number(video.currentTime || 0) > 0 || !video.paused ? 500 : 0;
      add(video.currentSrc || video.src || '', 3000 + visibleScore + activeScore);
      video.querySelectorAll('source').forEach((source) => add(source.src || '', 2500 + visibleScore));
    });

    document.querySelectorAll('a[href]').forEach((link) => {
      add(link.href || '', 300);
    });

    const resources = performance.getEntriesByType?.('resource') || [];
    resources.forEach((entry) => {
      const url = entry.name || '';
      const recentScore = Math.min(Number(entry.startTime || 0), 200000) / 100;
      const transferScore = Math.min(Number(entry.transferSize || entry.encodedBodySize || 0), 20000000) / 10000;
      const initiatorScore = /video|media|fetch|xmlhttprequest/i.test(entry.initiatorType || '') ? 600 : 0;
      add(url, 1000 + recentScore + transferScore + initiatorScore);
    });

    return candidates
      .sort((a, b) => b.score - a.score)
      .slice(0, 5)
      .map((item, index) => ({
        type: item.type,
        url: item.url,
        recommended: index === 0
      }));
  }

  function looksLikeVideoUrl(url) {
    return /(?:\.mp4|mime_type=video|video_mp4|videoweb|video\/tos|tos-cn-v|download=true|play_url|main_url)/i.test(url)
      && !/\.json(?:[?#]|$)|\.js(?:[?#]|$)|\.css(?:[?#]|$)|\.png(?:[?#]|$)|\.jpg(?:[?#]|$)|\.webp(?:[?#]|$)/i.test(url);
  }

  function makeCaptureButton(text, onClick) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = text;
    button.addEventListener('click', onClick);
    return button;
  }

  async function copyCapturedUrl(item) {
    try {
      await navigator.clipboard.writeText(item.url);
      setStatus('资源链接已复制。', 'success');
    } catch {
      setStatus('复制资源链接失败。', 'error');
    }
  }

  function downloadCapturedUrl(item) {
    chrome.runtime.sendMessage({ type: 'DOWNLOAD_MEDIA', url: item.url });
    setStatus('已提交浏览器下载。', 'success');
  }

  async function syncCapturedVideo(item) {
    const settings = saveSettings();
    if (!state.order?.recordId || !state.order?.lockId) {
      setStatus('请先接单，再同步捕获视频。', 'error');
      return;
    }
    if (!window.confirm(`确认同步这个捕获视频到当前接单记录？\n\n${shortUrl(item.url)}`)) {
      return;
    }
    try {
      setBusy(els.completeButton, '同步中...', true);
      setResult('正在同步捕获视频到飞书...');
      const data = await mailabApi('/api/complete', {
        recordId: state.order.recordId,
        lockId: state.order.lockId,
        assignee: settings.assignee,
        videoUrl: item.url,
        directComplete: true
      });
      if (!data.ok) {
        setStatus(data.error || '同步失败', 'error');
        return;
      }
      setResult('已同步捕获视频到飞书。', item.url);
      setStatus(`已同步捕获视频。\n${item.url}`, 'success', { duration: 12000 });
      state.order = null;
      clearActiveOrder();
      renderOrder();
      loadStats();
    } catch (error) {
      setStatus(error.message || '同步捕获视频失败', 'error');
    } finally {
      if (state.order) setBusy(els.completeButton, '同步完成', false);
      else els.completeButton.textContent = '同步完成';
    }
  }

  function shortUrl(url) {
    try {
      const parsed = new URL(url);
      return `${parsed.hostname}${parsed.pathname}`.slice(0, 42);
    } catch {
      return String(url || '').slice(0, 42);
    }
  }

  async function mailabApi(path, body) {
    const response = await sendMessage({ type: 'mailab-api', serverUrl: state.settings.serverUrl, path, body });
    if (!response?.ok) throw new Error(response?.error || '后端请求失败，请确认公网服务已启动。');
    return response.data;
  }

  async function loadStats(options = {}) {
    const manual = Boolean(options.manual);
    const settings = saveSettings();
    if (!settings.serverUrl) {
      els.pendingCount.textContent = '--';
      els.poolDetail.textContent = '填写后端地址后显示';
      if (manual) {
        setStatus('后端地址配置异常，请联系管理员。', 'error');
      }
      return;
    }
    if (manual) {
      setBusy(els.refreshStatsButton, '刷新中...', true);
      els.poolDetail.textContent = '正在刷新任务池...';
    }
    try {
      const data = await mailabApi('/api/stats', {});
      if (!data.ok || !data.counts) {
        throw new Error(data.error || '读取失败');
      }
      els.pendingCount.textContent = String(data.counts.pending ?? 0);
      els.poolDetail.textContent = `待接单 ${data.counts.pending ?? 0} 个，接单中 ${data.counts.inProgress ?? 0} 个`;
      if (manual) {
        setStatus('任务池状态已刷新。', 'success');
      }
    } catch (error) {
      els.pendingCount.textContent = '--';
      els.poolDetail.textContent = '任务数量读取失败';
      if (manual) {
        setStatus(error.message || '任务池状态读取失败。', 'error');
      }
    } finally {
      if (manual) {
        setBusy(els.refreshStatsButton, '刷新', false);
      }
    }
  }

  function sendMessage(payload) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(payload, (response) => {
        if (chrome.runtime.lastError && !response) {
          resolve({ ok: false, error: chrome.runtime.lastError.message });
          return;
        }
        resolve(response || { ok: false, error: '插件后台无响应' });
      });
    });
  }

  function setResult(text, url = '') {
    els.result.hidden = false;
    els.result.innerHTML = '';
    const body = document.createElement('div');
    body.textContent = text || '';
    els.result.appendChild(body);
    if (!url) return;
    const open = document.createElement('a');
    open.href = url;
    open.target = '_blank';
    open.rel = 'noreferrer';
    open.textContent = '打开视频';
    const copy = document.createElement('a');
    copy.href = '#';
    copy.textContent = '复制链接';
    copy.addEventListener('click', async (event) => {
      event.preventDefault();
      try {
        await navigator.clipboard.writeText(url);
        body.textContent = '链接已复制。';
      } catch {
        body.textContent = '复制失败，请手动复制。';
      }
    });
    els.result.append(open, copy);
  }

  function clearResult() {
    els.result.hidden = true;
    els.result.innerHTML = '';
  }

  function setStatus(text, type = '', options = {}) {
    els.status.textContent = text || '';
    showToast(text, type, options);
  }

  function showToast(text, type = '', options = {}) {
    if (!text) return;
    const lower = String(text).toLowerCase();
    const inferredType = type || (/失败|错误|无效|缺少|failed|error/.test(lower) ? 'error' : (/正在|处理中|等待|接单中/.test(lower) ? 'warn' : 'success'));
    els.toast.textContent = text;
    els.toast.hidden = false;
    els.toast.classList.toggle('is-error', inferredType === 'error');
    els.toast.classList.toggle('is-warn', inferredType === 'warn');
    clearTimeout(els.toast.__timer);
    els.toast.__timer = setTimeout(() => { els.toast.hidden = true; }, options.duration || (inferredType === 'error' ? 8000 : inferredType === 'warn' ? 5000 : 4200));
  }

  function setBusy(button, text, busy) {
    button.disabled = busy;
    button.textContent = text;
  }

  function saveActiveOrder() {
    if (!state.order?.recordId || !state.order?.lockId) return;
    chrome.storage.local.set({
      [ACTIVE_ORDER_KEY]: {
        recordId: state.order.recordId,
        lockId: state.order.lockId,
        assignee: state.order.assignee || state.settings.assignee,
        prompt: state.order.prompt || '',
        imageUrl: state.order.imageUrl || '',
        status: state.order.status || '',
        claimedAt: state.order.claimedAt || '',
        savedAt: Date.now()
      }
    });
  }

  function clearActiveOrder() {
    chrome.storage.local.remove(ACTIVE_ORDER_KEY);
  }

  function normalizeStoredOrder(order) {
    if (!order || typeof order !== 'object') return null;
    const recordId = String(order.recordId || '').trim();
    const lockId = String(order.lockId || '').trim();
    if (!recordId || !lockId) return null;
    return {
      recordId,
      lockId,
      assignee: String(order.assignee || '').trim(),
      prompt: String(order.prompt || ''),
      imageUrl: String(order.imageUrl || ''),
      status: String(order.status || ''),
      claimedAt: String(order.claimedAt || ''),
      savedAt: Number(order.savedAt || 0)
    };
  }

  function normalizeServerUrl(value) {
    return String(value || '').trim().replace(/\/+$/, '');
  }

  function normalizeHttpUrl(value) {
    const match = String(value || '').trim().match(/https?:\/\/[^\s"'<>]+/i);
    if (!match) return '';
    try { return new URL(match[0].replace(/\\u0026/g, '&')).toString(); } catch { return ''; }
  }

  function proxyImageUrl(imageUrl) {
    return `${state.settings.serverUrl}/api/image-proxy?url=${encodeURIComponent(imageUrl)}`;
  }

  function previewImageUrl(imageUrl) {
    return `${proxyImageUrl(imageUrl)}&preview=1&w=360&q=72`;
  }

  function normalizeDoubaoUrl(value) {
    const text = String(value || '').trim();
    const match = text.match(/https:\/\/www\.doubao\.com\/(?:thread\/[^\s"'<>]+|video-sharing\?[^\s"'<>]+)/);
    if (!match) return '';
    try {
      const url = new URL(match[0].replace(/\\u0026/g, '&'));
      if (url.pathname.startsWith('/thread/')) return `${url.origin}${url.pathname}`;
      if (url.pathname.includes('/video-sharing') && url.searchParams.get('share_id') && (url.searchParams.get('video_id') || url.searchParams.get('vid'))) return url.toString();
    } catch {
      return '';
    }
    return '';
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(value, max));
  }

})();
