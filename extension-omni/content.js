(() => {
  if (document.getElementById('mailab-omni-order-host')) return;

  const DEFAULT_SERVER_URL = 'https://genvideo.mailab.top';
  const SETTINGS_KEY = 'mailab_omni_settings';
  const ORDER_KEY = 'mailab_omni_active_order';
  const JOB_KEY = 'mailab_omni_active_job';
  const POSITION_KEY = 'mailab_omni_panel_position';
  const FLOW_PATH = /^\/fx\/tools\/flow\/shared\/video\/([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\/?$/i;

  const host = document.createElement('div');
  host.id = 'mailab-omni-order-host';
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = `
    <style>
      :host { all: initial; }
      *, *::before, *::after { box-sizing: border-box; }
      button, input, textarea { font: inherit; }
      .launcher {
        position: fixed; right: 18px; bottom: 88px; z-index: 2147483646;
        width: 52px; height: 52px; display: none; place-items: center;
        border: 1px solid rgba(255,255,255,.18); border-radius: 16px;
        background: #0f172a; color: #fff; box-shadow: 0 16px 46px rgba(0,0,0,.35);
        font: 800 12px/1 ui-sans-serif, system-ui; cursor: pointer;
      }
      .panel {
        position: fixed; top: 88px; right: 18px; z-index: 2147483646;
        width: min(430px, calc(100vw - 24px)); max-height: calc(100vh - 112px); overflow: auto;
        border: 1px solid rgba(148,163,184,.28); border-radius: 18px;
        background: #f8fafc; color: #0f172a; box-shadow: 0 24px 70px rgba(0,0,0,.35);
        font: 14px/1.45 ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      .panel.hidden { display: none; }
      .head {
        position: sticky; top: 0; z-index: 2; display: flex; align-items: center; justify-content: space-between;
        padding: 14px 16px; color: #fff; background: linear-gradient(135deg, #0f172a, #312e81);
        cursor: move; user-select: none;
      }
      .brand { display: flex; align-items: center; gap: 10px; }
      .brand-mark { display: grid; place-items: center; width: 36px; height: 36px; border-radius: 11px; background: #fff; color: #312e81; font-weight: 900; }
      .brand strong { display: block; font-size: 15px; }
      .brand span { display: block; margin-top: 1px; color: #cbd5e1; font-size: 11px; }
      .hide { width: 32px; height: 32px; border: 0; border-radius: 9px; background: rgba(255,255,255,.12); color: #fff; cursor: pointer; }
      .body { padding: 14px; }
      .pool, .task-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
      .pool { padding: 11px 12px; border-radius: 12px; background: #eef2ff; }
      .pool b { font-size: 22px; color: #4338ca; }
      .muted { color: #64748b; font-size: 12px; }
      .setup { display: grid; grid-template-columns: minmax(0,1fr) auto; gap: 8px; margin-top: 10px; }
      input, textarea {
        width: 100%; border: 1px solid #cbd5e1; border-radius: 10px; background: #fff; color: #0f172a; outline: none;
      }
      input { height: 42px; padding: 0 11px; }
      textarea { min-height: 82px; padding: 9px 11px; resize: vertical; }
      input:focus, textarea:focus { border-color: #6366f1; box-shadow: 0 0 0 3px rgba(99,102,241,.13); }
      button { border: 1px solid #cbd5e1; border-radius: 10px; background: #fff; color: #0f172a; cursor: pointer; font-weight: 700; }
      button:hover:not(:disabled) { border-color: #6366f1; }
      button:disabled { cursor: not-allowed; opacity: .48; }
      .primary { padding: 0 16px; border-color: #4f46e5; background: #4f46e5; color: #fff; }
      .panel-section { margin-top: 12px; padding: 12px; border: 1px solid #e2e8f0; border-radius: 13px; background: #fff; }
      .task-head strong { font-size: 14px; }
      .task-meta { max-width: 250px; overflow: hidden; color: #64748b; font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
      .actions { display: flex; gap: 6px; }
      .small { min-height: 32px; padding: 0 10px; font-size: 12px; }
      .danger { color: #b91c1c; }
      .materials { display: grid; grid-template-columns: 1fr 1fr; gap: 9px; margin-top: 10px; }
      .label { display: block; margin-bottom: 5px; color: #475569; font-size: 11px; font-weight: 750; }
      .prompt { height: 142px; min-height: 142px; font-size: 12px; }
      .image-frame { display: grid; place-items: center; height: 142px; overflow: hidden; border: 1px solid #e2e8f0; border-radius: 10px; background: #f8fafc; }
      .image-frame img { width: 100%; height: 100%; object-fit: contain; }
      .image-empty { padding: 12px; color: #94a3b8; font-size: 12px; text-align: center; }
      .complete-area { margin-top: 11px; }
      .hint { margin: 6px 0 0; color: #64748b; font-size: 11px; }
      .complete { width: 100%; min-height: 44px; margin-top: 9px; border-color: #059669; background: #059669; color: #fff; }
      .status { min-height: 38px; margin-top: 10px; padding: 9px 10px; border-radius: 10px; background: #f1f5f9; color: #475569; font-size: 12px; white-space: pre-wrap; }
      .status.success { background: #ecfdf5; color: #047857; }
      .status.warn { background: #fffbeb; color: #b45309; }
      .status.error { background: #fef2f2; color: #b91c1c; }
      .progress { height: 5px; margin-top: 8px; overflow: hidden; border-radius: 999px; background: #e2e8f0; }
      .progress > span { display: block; width: 32%; height: 100%; border-radius: inherit; background: #4f46e5; animation: move 1.1s ease-in-out infinite alternate; }
      @keyframes move { to { transform: translateX(210%); } }
      .result { margin-top: 8px; font-size: 12px; }
      .result a { color: #4338ca; word-break: break-all; }
      .toast {
        position: fixed; right: 18px; top: 20px; z-index: 2147483647; max-width: 360px;
        padding: 11px 14px; border-radius: 11px; background: #0f172a; color: #fff;
        box-shadow: 0 12px 36px rgba(0,0,0,.3); font: 13px/1.45 ui-sans-serif, system-ui; white-space: pre-wrap;
      }
      @media (max-width: 560px) {
        .panel { top: 12px; right: 12px; max-height: calc(100vh - 24px); }
        .materials { grid-template-columns: 1fr; }
      }
    </style>
    <button class="launcher" type="button" title="打开 Omni 接单面板">OMNI</button>
    <aside class="panel">
      <div class="head" id="dragHandle">
        <div class="brand"><div class="brand-mark">O</div><div><strong>MAILAB OMNI VIDEO</strong><span>Omni 公网接单工作台</span></div></div>
        <button class="hide" type="button" title="收起">—</button>
      </div>
      <div class="body">
        <div class="pool">
          <div><strong>任务池</strong><div class="muted" id="poolDetail">正在读取任务数量…</div></div>
          <div class="actions"><b id="pendingCount">--</b><button class="small" id="refreshButton" type="button">刷新</button></div>
        </div>
        <div class="setup">
          <input id="assigneeInput" type="text" maxlength="40" placeholder="输入接单人姓名">
          <button class="primary" id="claimButton" type="button">接单</button>
        </div>
        <section class="panel-section">
          <div class="task-head">
            <div><strong>当前 Omni 任务</strong><div class="task-meta" id="taskMeta">未接单</div></div>
            <div class="actions">
              <button class="small" id="copyPromptButton" type="button" disabled>复制提示词</button>
              <button class="small" id="copyImageButton" type="button" disabled>复制图片</button>
              <button class="small danger" id="releaseButton" type="button" disabled>释放</button>
            </div>
          </div>
          <div class="materials">
            <label><span class="label">提示词</span><textarea class="prompt" id="promptText" readonly placeholder="接单后显示提示词"></textarea></label>
            <div><span class="label">参考图片</span><div class="image-frame"><div class="image-empty" id="imageEmpty">接单后显示图片</div><img id="taskImage" alt="" hidden></div></div>
          </div>
          <div class="complete-area">
            <label><span class="label">Flow 单个视频公开分享链接</span><textarea id="flowInput" placeholder="https://labs.google/fx/tools/flow/shared/video/UUID"></textarea></label>
            <p class="hint">手动粘贴分享链接。插件不会监听或自动选择 Flow 视频。</p>
            <button class="complete" id="completeButton" type="button" disabled>转存 R2 并完成订单</button>
            <div class="progress" id="progress" hidden><span></span></div>
            <div class="status" id="status">输入接单人后点击接单。</div>
            <div class="result" id="result" hidden></div>
          </div>
        </section>
      </div>
    </aside>
    <div class="toast" id="toast" hidden></div>
  `;
  document.documentElement.appendChild(host);

  const $ = (selector) => shadow.querySelector(selector);
  const els = {
    launcher: $('.launcher'), panel: $('.panel'), hide: $('.hide'), drag: $('#dragHandle'),
    assignee: $('#assigneeInput'), claim: $('#claimButton'), refresh: $('#refreshButton'),
    pending: $('#pendingCount'), poolDetail: $('#poolDetail'), taskMeta: $('#taskMeta'),
    copyPrompt: $('#copyPromptButton'), copyImage: $('#copyImageButton'), release: $('#releaseButton'),
    prompt: $('#promptText'), image: $('#taskImage'), imageEmpty: $('#imageEmpty'),
    flow: $('#flowInput'), complete: $('#completeButton'), progress: $('#progress'),
    status: $('#status'), result: $('#result'), toast: $('#toast')
  };
  const state = {
    settings: { serverUrl: DEFAULT_SERVER_URL, assignee: '' },
    order: null,
    job: null,
    polling: false
  };

  els.launcher.addEventListener('click', () => setPanelOpen(true));
  els.hide.addEventListener('click', () => setPanelOpen(false));
  els.claim.addEventListener('click', claimOrder);
  els.refresh.addEventListener('click', () => loadStats(true));
  els.copyPrompt.addEventListener('click', copyPrompt);
  els.copyImage.addEventListener('click', copyImage);
  els.release.addEventListener('click', releaseOrder);
  els.complete.addEventListener('click', completeOrder);
  els.assignee.addEventListener('change', saveSettings);
  els.flow.addEventListener('input', () => {
    if (state.order && !state.job) storageSet({ [ORDER_KEY]: { ...state.order, flowShareUrl: els.flow.value.trim() } });
  });
  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === 'MAILAB_OMNI_TOGGLE') setPanelOpen(els.panel.classList.contains('hidden'));
  });

  installDrag();
  restoreState();

  async function restoreState() {
    const items = await storageGet({ [SETTINGS_KEY]: {}, [ORDER_KEY]: null, [JOB_KEY]: null, [POSITION_KEY]: null });
    const settings = items[SETTINGS_KEY] || {};
    state.settings.assignee = String(settings.assignee || '').trim();
    state.order = normalizeStoredOrder(items[ORDER_KEY]);
    state.job = normalizeStoredJob(items[JOB_KEY]);
    els.assignee.value = state.settings.assignee;
    if (state.order?.flowShareUrl) els.flow.value = state.order.flowShareUrl;
    restorePosition(items[POSITION_KEY]);
    render();
    loadStats();
    if (state.job && state.order) {
      setStatus('已恢复正在进行的 R2 转存任务。', 'warn');
      pollJob(state.job.jobId);
    } else if (state.order) {
      setStatus('已恢复上次未完成的 Omni 订单。', 'success');
    }
  }

  function saveSettings() {
    state.settings.assignee = String(els.assignee.value || '').trim();
    storageSet({ [SETTINGS_KEY]: { ...state.settings } });
    return state.settings;
  }

  async function claimOrder() {
    const settings = saveSettings();
    if (!settings.assignee) return setStatus('请先填写接单人。', 'error');
    if (state.order) return setStatus('当前已有未完成任务，请先完成或释放。', 'warn');
    setBusy(els.claim, '接单中…', true);
    setStatus('正在领取 Omni 任务…', 'warn');
    try {
      const data = await api('/api/claim', { assignee: settings.assignee, platform: 'Omni' });
      if (!data.ok) throw new Error(data.error || '暂无待接单任务');
      state.order = { ...data, platform: 'Omni', flowShareUrl: '' };
      await storageSet({ [ORDER_KEY]: state.order });
      els.flow.value = '';
      render();
      setStatus('接单成功。请复制图片和提示词，在 Flow 完成视频后粘贴分享链接。', 'success');
      loadStats();
    } catch (error) {
      setStatus(error.message || '接单失败', 'error');
    } finally {
      setBusy(els.claim, '接单', false);
      render();
    }
  }

  async function releaseOrder() {
    if (!state.order) return;
    if (state.job) return setStatus('视频正在转存，暂时不能释放任务。', 'warn');
    setBusy(els.release, '释放中…', true);
    try {
      const data = await api('/api/release', {
        recordId: state.order.recordId,
        lockId: state.order.lockId,
        reason: '用户在 Omni 插件中释放任务'
      });
      if (!data.ok) throw new Error(data.error || '释放任务失败');
      state.order = null;
      els.flow.value = '';
      await storageRemove([ORDER_KEY, JOB_KEY]);
      render();
      setStatus('任务已释放，可以重新接单。', 'success');
      loadStats();
    } catch (error) {
      setStatus(`释放失败，当前订单仍保留：${error.message || '未知错误'}`, 'error');
    } finally {
      setBusy(els.release, '释放', false);
      render();
    }
  }

  async function completeOrder() {
    if (!state.order) return setStatus('请先接单。', 'error');
    if (state.job) return pollJob(state.job.jobId);
    const flowShareUrl = normalizeFlowShareUrl(els.flow.value);
    if (!flowShareUrl) return setStatus('请输入单个视频的有效 Flow 公开分享链接。', 'error');
    els.flow.value = flowShareUrl;
    state.order.flowShareUrl = flowShareUrl;
    await storageSet({ [ORDER_KEY]: state.order });
    setTransferBusy(true);
    setStatus('正在提交 Flow 视频转存任务…', 'warn');
    clearResult();
    try {
      const data = await api('/api/omni/complete', {
        recordId: state.order.recordId,
        lockId: state.order.lockId,
        assignee: state.settings.assignee || state.order.assignee,
        flowShareUrl
      });
      if (!data.ok || !data.jobId) throw new Error(data.error || '转存任务创建失败');
      state.job = { jobId: data.jobId, flowShareUrl, startedAt: Date.now() };
      await storageSet({ [JOB_KEY]: state.job });
      await pollJob(data.jobId);
    } catch (error) {
      setTransferBusy(false);
      setStatus(error.message || '转存任务提交失败', 'error');
    }
  }

  async function pollJob(jobId) {
    if (state.polling) return;
    state.polling = true;
    setTransferBusy(true);
    try {
      for (let attempt = 0; attempt < 300 && state.job?.jobId === jobId; attempt += 1) {
        const data = await api('/api/omni/complete-status', { jobId });
        if (data.status === 'completed') {
          showResult(data.videoUrl);
          setStatus('R2 转存成功，已回填飞书并完成订单。', 'success');
          state.order = null;
          state.job = null;
          els.flow.value = '';
          await storageRemove([ORDER_KEY, JOB_KEY]);
          render();
          loadStats();
          return;
        }
        if (data.status === 'failed' || data.status === 'missing' || data.ok === false) {
          state.job = null;
          await storageRemove([JOB_KEY]);
          setStatus(data.error || data.message || '转存失败，订单保持接单中，可修改链接后重试。', 'error');
          render();
          return;
        }
        setStatus(data.message || '正在转存 R2，请稍候…', 'warn');
        await delay(2000);
      }
      if (state.job?.jobId === jobId) {
        setStatus('转存仍在后台进行。重新打开页面后会继续查询状态。', 'warn');
      }
    } catch (error) {
      setStatus(`状态查询失败，任务仍保留：${error.message || '未知错误'}`, 'error');
    } finally {
      state.polling = false;
      setTransferBusy(Boolean(state.job));
    }
  }

  async function copyPrompt() {
    const prompt = state.order?.prompt || '';
    if (!prompt) return setStatus('当前任务没有提示词。', 'error');
    try {
      await navigator.clipboard.writeText(prompt);
      setStatus('提示词已复制。', 'success');
    } catch {
      setStatus('复制提示词失败。', 'error');
    }
  }

  async function copyImage() {
    const imageUrl = normalizeHttpUrl(state.order?.imageUrl || '');
    if (!imageUrl) return setStatus('当前任务没有图片。', 'error');
    try {
      const response = await fetch(`${DEFAULT_SERVER_URL}/api/image-proxy?url=${encodeURIComponent(imageUrl)}`);
      if (!response.ok) throw new Error('图片读取失败');
      const blob = await response.blob();
      await navigator.clipboard.write([new ClipboardItem({ [blob.type || 'image/png']: blob })]);
      setStatus('图片已复制到剪贴板。', 'success');
    } catch {
      try {
        await navigator.clipboard.writeText(imageUrl);
        setStatus('图片复制失败，已改为复制图片地址。', 'warn');
      } catch {
        setStatus('复制图片失败。', 'error');
      }
    }
  }

  async function loadStats(manual = false) {
    if (manual) setBusy(els.refresh, '刷新中…', true);
    try {
      const data = await api('/api/stats', {});
      if (!data.ok || !data.counts) throw new Error(data.error || '读取失败');
      els.pending.textContent = String(data.counts.pending ?? 0);
      els.poolDetail.textContent = `待接单 ${data.counts.pending ?? 0} · 接单中 ${data.counts.inProgress ?? 0}`;
      if (manual) setStatus('任务池已刷新。', 'success');
    } catch (error) {
      els.pending.textContent = '--';
      els.poolDetail.textContent = '任务数量读取失败';
      if (manual) setStatus(error.message || '读取失败', 'error');
    } finally {
      if (manual) setBusy(els.refresh, '刷新', false);
    }
  }

  function render() {
    const order = state.order;
    els.claim.disabled = Boolean(order);
    els.copyPrompt.disabled = !order?.prompt;
    els.copyImage.disabled = !normalizeHttpUrl(order?.imageUrl || '');
    els.release.disabled = !order || Boolean(state.job);
    els.complete.disabled = !order || Boolean(state.job);
    els.assignee.disabled = Boolean(order);
    if (!order) {
      els.taskMeta.textContent = '未接单';
      els.prompt.value = '';
      els.image.hidden = true;
      els.image.removeAttribute('src');
      els.imageEmpty.hidden = false;
      els.imageEmpty.textContent = '接单后显示图片';
      return;
    }
    els.taskMeta.textContent = `${order.assignee || state.settings.assignee} · ${order.recordId} · Omni`;
    els.prompt.value = order.prompt || '';
    const imageUrl = normalizeHttpUrl(order.imageUrl || '');
    if (imageUrl) {
      els.image.src = `${DEFAULT_SERVER_URL}/api/image-proxy?url=${encodeURIComponent(imageUrl)}&preview=1&w=360&q=72`;
      els.image.hidden = false;
      els.imageEmpty.hidden = true;
      els.image.onerror = () => {
        els.image.hidden = true;
        els.imageEmpty.hidden = false;
        els.imageEmpty.textContent = '图片预览失败，可点击复制图片';
      };
    } else {
      els.image.hidden = true;
      els.imageEmpty.hidden = false;
      els.imageEmpty.textContent = '当前任务没有图片';
    }
  }

  function setTransferBusy(busy) {
    els.progress.hidden = !busy;
    els.complete.disabled = busy || !state.order;
    els.complete.textContent = busy ? '正在转存 R2…' : '转存 R2 并完成订单';
    els.release.disabled = busy || !state.order;
  }

  function showResult(url) {
    els.result.hidden = false;
    els.result.textContent = '';
    const text = document.createElement('span');
    text.textContent = 'R2 视频：';
    const link = document.createElement('a');
    link.href = url;
    link.target = '_blank';
    link.rel = 'noreferrer';
    link.textContent = url;
    els.result.append(text, link);
  }

  function clearResult() {
    els.result.hidden = true;
    els.result.textContent = '';
  }

  function setStatus(text, type = '') {
    els.status.textContent = text || '';
    els.status.className = `status${type ? ` ${type}` : ''}`;
    if (!text) return;
    els.toast.textContent = text;
    els.toast.hidden = false;
    clearTimeout(els.toast.__timer);
    els.toast.__timer = setTimeout(() => { els.toast.hidden = true; }, type === 'error' ? 8000 : 4200);
  }

  function setBusy(button, text, busy) {
    button.disabled = busy;
    button.textContent = text;
  }

  function setPanelOpen(open) {
    els.panel.classList.toggle('hidden', !open);
    els.launcher.style.display = open ? 'none' : 'grid';
  }

  function installDrag() {
    let dragging = false;
    let offsetX = 0;
    let offsetY = 0;
    els.drag.addEventListener('pointerdown', (event) => {
      if (event.target === els.hide) return;
      dragging = true;
      const rect = els.panel.getBoundingClientRect();
      offsetX = event.clientX - rect.left;
      offsetY = event.clientY - rect.top;
      els.drag.setPointerCapture?.(event.pointerId);
    });
    els.drag.addEventListener('pointermove', (event) => {
      if (!dragging) return;
      event.preventDefault();
      const left = clamp(event.clientX - offsetX, 8, window.innerWidth - 80);
      const top = clamp(event.clientY - offsetY, 8, window.innerHeight - 80);
      els.panel.style.left = `${left}px`;
      els.panel.style.top = `${top}px`;
      els.panel.style.right = 'auto';
    });
    els.drag.addEventListener('pointerup', () => {
      if (!dragging) return;
      dragging = false;
      const rect = els.panel.getBoundingClientRect();
      storageSet({ [POSITION_KEY]: { left: rect.left, top: rect.top } });
    });
  }

  function restorePosition(position) {
    if (!position || !Number.isFinite(position.left) || !Number.isFinite(position.top)) return;
    els.panel.style.left = `${clamp(position.left, 8, window.innerWidth - 80)}px`;
    els.panel.style.top = `${clamp(position.top, 8, window.innerHeight - 80)}px`;
    els.panel.style.right = 'auto';
  }

  async function api(path, body) {
    const response = await sendMessage({ type: 'mailab-api', serverUrl: DEFAULT_SERVER_URL, path, body });
    if (!response?.ok) throw new Error(response?.error || '插件后台无响应');
    return response.data;
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

  function normalizeFlowShareUrl(value) {
    let url;
    try { url = new URL(String(value || '').trim()); } catch { return ''; }
    if (url.protocol !== 'https:' || url.hostname !== 'labs.google' || url.username || url.password) return '';
    const match = url.pathname.match(FLOW_PATH);
    return match ? `https://labs.google/fx/tools/flow/shared/video/${match[1].toLowerCase()}` : '';
  }

  function normalizeHttpUrl(value) {
    try {
      const url = new URL(String(value || '').trim());
      return /^https?:$/.test(url.protocol) ? url.toString() : '';
    } catch { return ''; }
  }

  function normalizeStoredOrder(value) {
    if (!value?.recordId || !value?.lockId) return null;
    return {
      recordId: String(value.recordId), lockId: String(value.lockId), assignee: String(value.assignee || ''),
      prompt: String(value.prompt || ''), imageUrl: String(value.imageUrl || ''), status: String(value.status || ''),
      platform: 'Omni', flowShareUrl: String(value.flowShareUrl || '')
    };
  }

  function normalizeStoredJob(value) {
    return value?.jobId ? { jobId: String(value.jobId), flowShareUrl: String(value.flowShareUrl || ''), startedAt: Number(value.startedAt || 0) } : null;
  }

  function storageGet(defaults) {
    return new Promise((resolve) => chrome.storage.local.get(defaults, resolve));
  }

  function storageSet(value) {
    return new Promise((resolve) => chrome.storage.local.set(value, resolve));
  }

  function storageRemove(keys) {
    return new Promise((resolve) => chrome.storage.local.remove(keys, resolve));
  }

  function delay(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
  function clamp(value, min, max) { return Math.max(min, Math.min(value, max)); }
})();
