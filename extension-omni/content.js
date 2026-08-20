(() => {
  const DEFAULT_SERVER_URL = 'https://genvideo.mailab.top';
  const BATCH_KEY = 'mailab_omni_batch_state_v2';
  const POSITION_KEY = 'mailab_omni_batch_position_v2';
  const MAX_ACTIVE = 10;
  const PLUGIN_VERSION = chrome.runtime.getManifest().version;
  const adapter = globalThis.MailabFlowAdapter;
  const SHARE_PATH = /^\/fx\/tools\/flow\/shared\/video\/([0-9a-f-]{36})\/?$/i;
  let shareWorkerPromise = null;

  if (!adapter) return;
  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === 'MAILAB_RUN_SHARE_WORKER' && adapter.isEditPage()) runShareWorker();
  });
  if (adapter.isEditPage()) {
    runShareWorker();
    return;
  }
  if (!adapter.isProjectPage() || document.getElementById('mailab-omni-batch-host')) return;

  const host = document.createElement('div');
  host.id = 'mailab-omni-batch-host';
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = `
    <style>
      :host { all: initial; }
      *, *::before, *::after { box-sizing: border-box; }
      button, input, select, textarea { font: inherit; }
      .launcher { position: fixed; right: 18px; bottom: 88px; z-index: 2147483646; display: none; width: 58px; height: 58px; border: 1px solid #394238; border-radius: 18px; background: #111510; color: #cbff47; box-shadow: 0 18px 55px #0009; font: 900 11px/1 ui-monospace, monospace; cursor: pointer; }
      .panel { position: fixed; top: 72px; right: 16px; z-index: 2147483646; width: min(480px, calc(100vw - 24px)); max-height: calc(100vh - 94px); overflow: hidden; border: 1px solid #343b32; border-radius: 18px; background: #0d100d; color: #eef5e8; box-shadow: 0 24px 80px #000b; font: 13px/1.42 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
      .panel.hidden { display: none; }
      .head { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 13px 14px; border-bottom: 1px solid #2a3028; background: #151914; cursor: move; user-select: none; }
      .brand { display: flex; align-items: center; gap: 10px; min-width: 0; }
      .mark { display: grid; place-items: center; flex: 0 0 auto; width: 37px; height: 37px; border-radius: 11px; background: #cbff47; color: #11150e; font: 950 15px/1 ui-monospace, monospace; }
      .brand strong { display: block; font-size: 14px; letter-spacing: .04em; }
      .brand span { display: block; margin-top: 2px; color: #8d9789; font-size: 10px; }
      .icon { width: 32px; height: 32px; border: 1px solid #384036; border-radius: 9px; background: #20251e; color: #d9e0d4; cursor: pointer; }
      .body { max-height: calc(100vh - 154px); overflow: auto; padding: 12px; }
      .stats { display: grid; grid-template-columns: 1fr auto; gap: 8px; align-items: center; padding: 10px 11px; border: 1px solid #2c332a; border-radius: 12px; background: #151914; }
      .stats strong { color: #cbff47; font: 900 24px/1 ui-monospace, monospace; }
      .muted { color: #8f998b; font-size: 11px; }
      .claim { display: grid; grid-template-columns: minmax(0,1fr) 76px 104px; gap: 7px; margin-top: 9px; }
      input, select, textarea { width: 100%; border: 1px solid #343b31; border-radius: 9px; background: #171b16; color: #eef4e9; outline: none; }
      input, select { height: 40px; padding: 0 10px; }
      textarea { padding: 8px 9px; resize: vertical; }
      input:focus, select:focus, textarea:focus { border-color: #93bb38; box-shadow: 0 0 0 2px #cbff4724; }
      button { border: 1px solid #364033; border-radius: 9px; background: #20251f; color: #e6ede1; font-weight: 750; cursor: pointer; }
      button:hover:not(:disabled) { border-color: #94b944; }
      button:disabled { opacity: .43; cursor: not-allowed; }
      .primary { border-color: #cbff47; background: #cbff47; color: #10140d; }
      .toolbar { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 6px; margin-top: 8px; }
      .toolbar button { min-height: 36px; padding: 5px 7px; font-size: 11px; }
      .notice { margin-top: 9px; padding: 8px 10px; border-left: 3px solid #cbff47; border-radius: 7px; background: #171c15; color: #aeb9aa; font-size: 11px; white-space: pre-wrap; }
      .notice.error { border-color: #ff654f; color: #ffb4a9; }
      .notice.warn { border-color: #ffae4d; color: #ffd39b; }
      .queue { display: grid; gap: 9px; margin-top: 10px; }
      .empty { padding: 30px 14px; border: 1px dashed #3a4337; border-radius: 12px; color: #7f897c; text-align: center; }
      .card { position: relative; overflow: hidden; border: 1px solid #2d342b; border-radius: 13px; background: #131712; }
      .card::before { position: absolute; inset: 0 auto 0 0; width: 3px; background: #596454; content: ""; }
      .card[data-state="feeding"]::before, .card[data-state="generating"]::before, .card[data-state="sharing"]::before, .card[data-state="processing"]::before { background: #ffae4d; }
      .card[data-state="completed"]::before { background: #cbff47; }
      .card[data-state="error"]::before { background: #ff654f; }
      .card-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 10px 11px 8px 13px; }
      .order-id { min-width: 0; color: #aeb7aa; font: 700 10px/1.2 ui-monospace, monospace; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .chip { flex: 0 0 auto; padding: 4px 7px; border: 1px solid #394137; border-radius: 999px; color: #cbd4c6; font-size: 10px; }
      .materials { display: grid; grid-template-columns: 118px 1fr; gap: 9px; padding: 0 11px 9px 13px; }
      .image { display: grid; place-items: center; height: 118px; overflow: hidden; border: 1px solid #2e352c; border-radius: 9px; background: #0b0e0b; }
      .image img { width: 100%; height: 100%; object-fit: contain; }
      .prompt { height: 118px; min-height: 118px; color: #cdd6c8; font-size: 11px; }
      .message { margin: 0 11px 9px 13px; color: #9ca797; font-size: 11px; }
      .progress { height: 3px; margin: 0 11px 9px 13px; overflow: hidden; border-radius: 99px; background: #2a3028; }
      .progress span { display: block; width: 34%; height: 100%; background: #ffae4d; animation: move 1.1s ease-in-out infinite alternate; }
      @keyframes move { to { transform: translateX(195%); } }
      .manual { display: grid; grid-template-columns: 1fr 88px; gap: 6px; padding: 0 11px 8px 13px; }
      .manual input { height: 34px; font-size: 10px; }
      .manual button { font-size: 10px; }
      .actions { display: grid; grid-template-columns: 1fr auto auto; gap: 6px; padding: 0 11px 11px 13px; }
      .actions button { min-height: 36px; padding: 5px 9px; font-size: 11px; }
      .danger { color: #ff8d7c; }
      .result { display: block; margin: 0 11px 10px 13px; color: #cbff47; font-size: 10px; word-break: break-all; }
      .toast { position: fixed; top: 18px; right: 18px; z-index: 2147483647; max-width: 390px; padding: 10px 13px; border: 1px solid #46503f; border-radius: 10px; background: #151a13; color: #eef4e9; box-shadow: 0 14px 45px #000a; font: 12px/1.45 -apple-system, sans-serif; white-space: pre-wrap; }
      @media (max-width: 580px) { .panel { top: 8px; right: 8px; max-height: calc(100vh - 16px); } .body { max-height: calc(100vh - 78px); } .claim { grid-template-columns: 1fr 72px; } .claim .primary { grid-column: 1 / -1; } .materials { grid-template-columns: 92px 1fr; } .image, .prompt { height: 104px; min-height: 104px; } }
    </style>
    <button class="launcher" type="button">OMNI</button>
    <aside class="panel">
      <header class="head" id="drag-handle">
        <div class="brand"><div class="mark">O</div><div><strong>OMNI AUTO DESK</strong><span>v${PLUGIN_VERSION} · 批量投喂 · 生成监控 · 自动回填</span></div></div>
        <button class="icon" id="hide-button" type="button">—</button>
      </header>
      <main class="body">
        <div class="stats"><div><b>待接任务池</b><div class="muted" id="pool-detail">正在连接服务…</div></div><strong id="pending-count">--</strong></div>
        <form class="claim" id="claim-form">
          <input id="assignee-input" maxlength="40" placeholder="接单人姓名" required>
          <select id="count-input" title="批量数量"></select>
          <button class="primary" id="claim-button" type="submit">批量接单</button>
        </form>
        <div class="toolbar">
          <button id="auto-all-button" type="button">全部自动投喂</button>
          <button id="recover-button" type="button">校验恢复</button>
          <button id="refresh-button" type="button">刷新任务池</button>
        </div>
        <div class="notice" id="notice">先批量接单，再点击“全部自动投喂”。插件会逐条上传，但视频生成会并行等待。</div>
        <section class="queue" id="queue"></section>
      </main>
    </aside>
    <div class="toast" id="toast" hidden></div>
  `;
  document.documentElement.appendChild(host);

  const $ = (selector) => shadow.querySelector(selector);
  const els = {
    launcher: $('.launcher'), panel: $('.panel'), hide: $('#hide-button'), drag: $('#drag-handle'),
    assignee: $('#assignee-input'), count: $('#count-input'), claimForm: $('#claim-form'), claim: $('#claim-button'),
    autoAll: $('#auto-all-button'), recover: $('#recover-button'), refresh: $('#refresh-button'),
    pending: $('#pending-count'), poolDetail: $('#pool-detail'), notice: $('#notice'), queue: $('#queue'), toast: $('#toast')
  };
  for (let count = 1; count <= MAX_ACTIVE; count += 1) {
    const option = document.createElement('option');
    option.value = String(count);
    option.textContent = `${count} 单`;
    if (count === 5) option.selected = true;
    els.count.append(option);
  }

  const state = { assignee: '', orders: [] };
  const feedQueue = [];
  const feedingIds = new Set();
  const jobPollers = new Set();
  const reservedUrls = new Set();
  let feedLoopRunning = false;
  let claimBusy = false;
  let recoverBusy = false;

  els.launcher.addEventListener('click', () => setPanelOpen(true));
  els.hide.addEventListener('click', () => setPanelOpen(false));
  els.claimForm.addEventListener('submit', claimBatch);
  els.autoAll.addEventListener('click', enqueueAll);
  els.recover.addEventListener('click', () => recoverOrders(false));
  els.refresh.addEventListener('click', () => loadStats(true));
  els.queue.addEventListener('click', onQueueClick);
  els.queue.addEventListener('input', onQueueInput);
  els.assignee.addEventListener('change', () => {
    state.assignee = String(els.assignee.value || '').trim();
    persist();
  });
  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === 'MAILAB_OMNI_TOGGLE') setPanelOpen(els.panel.classList.contains('hidden'));
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes[BATCH_KEY]?.newValue) return;
    applyStoredState(changes[BATCH_KEY].newValue);
    render();
    ensureJobPollers();
  });
  installDrag();
  restore();

  async function restore() {
    const stored = await storageGet({ [BATCH_KEY]: { assignee: '', orders: [] }, [POSITION_KEY]: null });
    applyStoredState(stored[BATCH_KEY]);
    state.orders = state.orders.map((order) => ['queued', 'feeding', 'generating', 'sharing'].includes(order.state)
      ? { ...order, state: 'error', message: '页面刷新中断了自动映射；可重新投喂，或手动粘贴对应分享链接' }
      : order);
    await persist();
    restorePosition(stored[POSITION_KEY]);
    render();
    loadStats();
    if (activeOrders().length) recoverOrders(true);
    ensureJobPollers();
  }

  function applyStoredState(value) {
    state.assignee = String(value?.assignee || state.assignee || '').trim();
    state.orders = Array.isArray(value?.orders) ? value.orders.map(normalizeOrder).filter(Boolean) : state.orders;
    els.assignee.value = state.assignee;
    for (const order of state.orders) if (order.editUrl) reservedUrls.add(order.editUrl);
  }

  async function claimBatch(event) {
    event.preventDefault();
    if (claimBusy) return;
    const assignee = String(els.assignee.value || '').trim();
    const capacity = MAX_ACTIVE - activeOrders().length;
    const count = Math.min(capacity, Math.max(1, Number(els.count.value || 1)));
    if (!assignee) return setNotice('请先填写接单人姓名。', 'error');
    if (capacity <= 0) return setNotice('当前浏览器已有 10 个活动任务，请先完成或释放。', 'warn');
    claimBusy = true;
    state.assignee = assignee;
    renderControls();
    setNotice(`正在批量领取 ${count} 个 Omni 任务…`, 'warn');
    try {
      const data = await api('/api/omni/claim-batch', { assignee, count }, 120000);
      if (!data.ok || !Array.isArray(data.orders)) throw new Error(data.error || '批量接单失败');
      const claimed = data.orders.map((order) => normalizeOrder({ ...order, state: 'claimed', message: '接单成功，等待自动投喂' })).filter(Boolean);
      state.orders.push(...claimed.filter((order) => !state.orders.some((item) => item.recordId === order.recordId)));
      await persist();
      setNotice(`已领取 ${claimed.length} 单。可逐单点击，或使用“全部自动投喂”。`, 'success');
      loadStats();
    } catch (error) {
      setNotice(error.message || '批量接单失败', 'error');
    } finally {
      claimBusy = false;
      render();
    }
  }

  async function recoverOrders(silent = false) {
    if (recoverBusy || !activeOrders().length || !state.assignee) return;
    recoverBusy = true;
    renderControls();
    try {
      const candidates = activeOrders().map(({ recordId, lockId }) => ({ recordId, lockId }));
      const data = await api('/api/omni/recover', { assignee: state.assignee, orders: candidates }, 60000);
      if (!data.ok) throw new Error(data.error || '恢复校验失败');
      const recovered = new Map((data.orders || []).map((order) => [String(order.recordId), order]));
      const missing = new Set((data.missing || []).map((item) => String(item.recordId || item)));
      state.orders = state.orders.map((order) => {
        if (missing.has(order.recordId)) return { ...order, state: 'lost', message: '飞书锁已失效，不能继续回填' };
        const remote = recovered.get(order.recordId);
        if (!remote) return order;
        if (remote.state === 'completed') return { ...order, state: 'completed', resultUrl: remote.videoUrl || order.resultUrl, message: '飞书已完成回填' };
        if (remote.state === 'processing') return { ...order, state: 'processing', jobId: remote.jobId || order.jobId, message: remote.message || order.message };
        return order;
      });
      await persist();
      if (!silent) setNotice('任务锁与飞书状态校验完成。', 'success');
    } catch (error) {
      if (!silent) setNotice(error.message || '恢复校验失败', 'error');
    } finally {
      recoverBusy = false;
      render();
      ensureJobPollers();
    }
  }

  async function enqueueAll() {
    const candidates = state.orders.filter((order) => ['claimed', 'error'].includes(order.state));
    if (!candidates.length) return setNotice('没有可自动投喂的订单。', 'warn');
    for (const order of candidates) {
      feedQueue.push(order.recordId);
      await patchLocal(order.recordId, { state: 'queued', message: '已进入自动投喂队列' });
    }
    processFeedQueue();
    setNotice(`已加入 ${candidates.length} 单。插件将逐条投喂，生成任务会并行等待。`, 'success');
  }

  async function enqueueOrder(recordId) {
    const order = getOrder(recordId);
    if (!order || !['claimed', 'error'].includes(order.state) || feedQueue.includes(recordId) || feedingIds.has(recordId)) return;
    feedQueue.push(recordId);
    await patchLocal(recordId, { state: 'queued', message: '已进入自动投喂队列' });
    processFeedQueue();
  }

  async function processFeedQueue() {
    if (feedLoopRunning) return;
    feedLoopRunning = true;
    while (feedQueue.length) {
      const recordId = feedQueue.shift();
      const order = getOrder(recordId);
      if (!order || !['queued', 'claimed', 'error'].includes(order.state)) continue;
      feedingIds.add(recordId);
      try {
        const tracker = await submitGeneration(order);
        monitorGeneration(recordId, tracker.result);
      } catch (error) {
        await patchLocal(recordId, { state: 'error', message: error.message || '自动投喂失败' });
      } finally {
        feedingIds.delete(recordId);
      }
    }
    feedLoopRunning = false;
    renderControls();
  }

  async function submitGeneration(order) {
    await patchLocal(order.recordId, { state: 'feeding', message: '正在配置 Omni 并上传图片' });
    await adapter.clearComposer();
    const settings = await adapter.ensureOmniSettings();
    await patchLocal(order.recordId, { message: `参数已确认：${settings}；正在上传图片` });
    const blob = await fetchImage(order.imageUrl);
    const filename = createFilename(order.recordId, blob.type);
    await adapter.uploadAndAttach(blob, filename);
    await patchLocal(order.recordId, { message: '图片已加入，正在写入提示词' });
    await adapter.setSlatePrompt(order.prompt);
    const tracker = adapter.startGeneration({ reservedUrls });
    await patchLocal(order.recordId, { state: 'generating', message: '已提交 Flow，等待视频生成', generationStartedAt: Date.now() });
    await tracker.submitted;
    return tracker;
  }

  async function monitorGeneration(recordId, resultPromise) {
    try {
      const editUrl = await resultPromise;
      await patchLocal(recordId, { state: 'sharing', editUrl, message: '视频生成成功，正在取得公开分享链接' });
      const order = getOrder(recordId);
      const response = await sendMessage({
        type: 'MAILAB_OPEN_SHARE_WORK',
        work: { editUrl, recordId, lockId: order.lockId, assignee: order.assignee || state.assignee, serverUrl: DEFAULT_SERVER_URL }
      });
      if (!response?.ok) throw new Error(response?.error || '无法打开自动分享页');
    } catch (error) {
      await patchLocal(recordId, { state: 'error', message: error.message || '生成监控失败，可手动粘贴分享链接' });
    }
  }

  async function manualComplete(recordId) {
    const order = getOrder(recordId);
    const shareUrl = normalizeShareUrl(order?.manualShareUrl);
    if (!order || !shareUrl) return setNotice('请先填写有效的 Flow 单视频分享链接。', 'error');
    try {
      await patchLocal(recordId, { state: 'sharing', message: '正在提交手动分享链接' });
      const data = await api('/api/omni/complete', {
        recordId: order.recordId,
        lockId: order.lockId,
        assignee: order.assignee || state.assignee,
        flowShareUrl: shareUrl
      });
      if (!data.ok || !data.jobId) throw new Error(data.error || '转存任务创建失败');
      await patchLocal(recordId, { state: 'processing', jobId: data.jobId, shareUrl, message: '正在转存 R2' });
      ensureJobPollers();
    } catch (error) {
      await patchLocal(recordId, { state: 'error', message: error.message || '手动回填失败' });
    }
  }

  function ensureJobPollers() {
    for (const order of state.orders) {
      if (order.state === 'processing' && order.jobId && !jobPollers.has(order.jobId)) pollJob(order.recordId, order.jobId);
    }
  }

  async function pollJob(recordId, jobId) {
    jobPollers.add(jobId);
    try {
      for (let attempt = 0; attempt < 450; attempt += 1) {
        const current = getOrder(recordId);
        if (!current || current.jobId !== jobId || current.state !== 'processing') return;
        const data = await api('/api/omni/complete-status', { jobId }, 20000);
        if (data.status === 'completed') {
          await patchLocal(recordId, { state: 'completed', resultUrl: data.videoUrl || '', message: 'R2 已验证，飞书已自动回填', completedAt: Date.now() });
          loadStats();
          return;
        }
        if (data.status === 'failed' || data.status === 'missing' || data.ok === false) {
          await patchLocal(recordId, { state: 'error', jobId: '', message: data.error || data.message || '转存失败，可重试' });
          return;
        }
        await patchLocal(recordId, { message: data.message || '正在获取 Flow 视频并转存 R2' });
        await delay(2000);
      }
      await patchLocal(recordId, { state: 'error', message: 'R2 转存查询超时，请点击校验恢复' });
    } catch (error) {
      await patchLocal(recordId, { state: 'error', message: `转存状态查询失败：${error.message || '未知错误'}` });
    } finally {
      jobPollers.delete(jobId);
    }
  }

  async function releaseOrder(recordId) {
    const order = getOrder(recordId);
    if (!order || !['claimed', 'queued', 'error'].includes(order.state)) return;
    try {
      const data = await api('/api/release', { recordId, lockId: order.lockId, reason: 'Omni 自动插件释放任务' });
      if (!data.ok) throw new Error(data.error || '释放失败');
      state.orders = state.orders.filter((item) => item.recordId !== recordId);
      await persist();
      setNotice('订单已释放。', 'success');
      loadStats();
    } catch (error) {
      setNotice(error.message || '释放失败', 'error');
    }
  }

  function onQueueClick(event) {
    const button = event.target.closest('button[data-action]');
    if (!button) return;
    const card = button.closest('[data-record-id]');
    const recordId = card?.dataset.recordId;
    if (!recordId) return;
    if (button.dataset.action === 'feed') enqueueOrder(recordId);
    if (button.dataset.action === 'manual') manualComplete(recordId);
    if (button.dataset.action === 'release') releaseOrder(recordId);
    if (button.dataset.action === 'copy') copyText(getOrder(recordId)?.prompt || '');
  }

  function onQueueInput(event) {
    const input = event.target.closest('input[data-action="share-input"]');
    if (!input) return;
    const recordId = input.closest('[data-record-id]')?.dataset.recordId;
    const order = getOrder(recordId);
    if (!order) return;
    order.manualShareUrl = input.value.trim();
    schedulePersist();
  }

  async function loadStats(manual = false) {
    if (manual) setNotice('正在刷新任务池…', 'warn');
    try {
      const data = await api('/api/stats', {});
      if (!data.ok || !data.counts) throw new Error(data.error || '读取失败');
      els.pending.textContent = String(data.counts.pending ?? 0).padStart(2, '0');
      els.poolDetail.textContent = `待接 ${data.counts.pending ?? 0} · 接单中 ${data.counts.inProgress ?? 0}`;
      if (manual) setNotice('任务池已刷新。', 'success');
    } catch (error) {
      els.pending.textContent = '--';
      els.poolDetail.textContent = error.message || '任务池连接失败';
      if (manual) setNotice(error.message || '任务池连接失败', 'error');
    }
  }

  function render() {
    els.assignee.value = state.assignee;
    els.queue.textContent = '';
    if (!state.orders.length) {
      const empty = document.createElement('div');
      empty.className = 'empty';
      empty.textContent = '暂无已领取的 Omni 任务';
      els.queue.append(empty);
    } else {
      for (const order of state.orders) els.queue.append(renderCard(order));
    }
    renderControls();
  }

  function renderCard(order) {
    const card = document.createElement('article');
    card.className = 'card';
    card.dataset.recordId = order.recordId;
    card.dataset.state = order.state;
    card.innerHTML = `
      <div class="card-head"><span class="order-id"></span><span class="chip"></span></div>
      <div class="materials"><div class="image"><img alt="任务参考图"></div><textarea class="prompt" readonly></textarea></div>
      <div class="message"></div>
      <div class="progress" hidden><span></span></div>
      <div class="manual"><input data-action="share-input" placeholder="自动失败时粘贴 Flow 分享链接"><button data-action="manual" type="button">手动回填</button></div>
      <div class="actions"><button class="primary" data-action="feed" type="button">投喂并生成</button><button data-action="copy" type="button">复制提示词</button><button class="danger" data-action="release" type="button">释放</button></div>
    `;
    card.querySelector('.order-id').textContent = `${order.assignee || state.assignee} · ${order.recordId}`;
    card.querySelector('.chip').textContent = statusLabel(order.state);
    card.querySelector('.prompt').value = order.prompt || '当前任务没有提示词';
    card.querySelector('.message').textContent = order.message || '等待处理';
    const image = card.querySelector('img');
    if (order.imageUrl) image.src = `${DEFAULT_SERVER_URL}/api/image-proxy?url=${encodeURIComponent(order.imageUrl)}&preview=1&w=260&q=72`;
    else image.hidden = true;
    const working = ['feeding', 'generating', 'sharing', 'processing'].includes(order.state);
    card.querySelector('.progress').hidden = !working;
    const feed = card.querySelector('[data-action="feed"]');
    feed.disabled = !['claimed', 'error'].includes(order.state);
    feed.textContent = order.state === 'error' ? '重新投喂' : (working ? '自动处理中' : '投喂并生成');
    const release = card.querySelector('[data-action="release"]');
    release.disabled = !['claimed', 'queued', 'error'].includes(order.state);
    const manual = card.querySelector('[data-action="share-input"]');
    manual.value = order.manualShareUrl || order.shareUrl || '';
    manual.disabled = ['processing', 'completed'].includes(order.state);
    card.querySelector('[data-action="manual"]').disabled = ['processing', 'completed'].includes(order.state);
    if (order.resultUrl) {
      const link = document.createElement('a');
      link.className = 'result';
      link.href = order.resultUrl;
      link.target = '_blank';
      link.rel = 'noreferrer';
      link.textContent = `R2：${order.resultUrl}`;
      card.append(link);
    }
    return card;
  }

  function renderControls() {
    const active = activeOrders().length;
    const hasFeedable = state.orders.some((order) => ['claimed', 'error'].includes(order.state));
    els.assignee.disabled = active > 0 || claimBusy;
    els.count.disabled = claimBusy || active >= MAX_ACTIVE;
    els.claim.disabled = claimBusy || active >= MAX_ACTIVE;
    els.claim.textContent = claimBusy ? '接单中…' : '批量接单';
    els.autoAll.disabled = !hasFeedable || feedLoopRunning;
    els.autoAll.textContent = feedLoopRunning ? `投喂中 ${feedQueue.length + feedingIds.size}` : '全部自动投喂';
    els.recover.disabled = recoverBusy || !active;
  }

  async function patchLocal(recordId, patch) {
    const order = getOrder(recordId);
    if (!order) return null;
    Object.assign(order, patch, { updatedAt: Date.now() });
    render();
    await persist();
    return order;
  }

  function getOrder(recordId) {
    return state.orders.find((order) => order.recordId === recordId) || null;
  }

  function activeOrders() {
    return state.orders.filter((order) => !['completed', 'lost'].includes(order.state));
  }

  function normalizeOrder(value) {
    if (!value?.recordId || !value?.lockId) return null;
    return {
      recordId: String(value.recordId), lockId: String(value.lockId), assignee: String(value.assignee || state.assignee || ''),
      prompt: String(value.prompt || ''), imageUrl: String(value.imageUrl || ''), state: String(value.state || 'claimed'),
      message: String(value.message || ''), editUrl: String(value.editUrl || ''), shareUrl: String(value.shareUrl || ''),
      manualShareUrl: String(value.manualShareUrl || ''), jobId: String(value.jobId || ''), resultUrl: String(value.resultUrl || ''),
      generationStartedAt: Number(value.generationStartedAt || 0), completedAt: Number(value.completedAt || 0), updatedAt: Number(value.updatedAt || Date.now())
    };
  }

  function statusLabel(value) {
    return ({ claimed: '待投喂', queued: '排队中', feeding: '上传中', generating: '生成中', sharing: '取链接', processing: '转存中', completed: '已完成', error: '需重试', lost: '已失效' })[value] || value;
  }

  async function fetchImage(imageUrl) {
    if (!/^https?:\/\//i.test(String(imageUrl || ''))) throw new Error('当前订单没有有效图片');
    const response = await fetch(`${DEFAULT_SERVER_URL}/api/image-proxy?url=${encodeURIComponent(imageUrl)}`);
    if (!response.ok) throw new Error(`任务图片下载失败 HTTP ${response.status}`);
    const blob = await response.blob();
    if (!/^image\//i.test(blob.type)) throw new Error('任务图片格式无效');
    return blob;
  }

  function createFilename(recordId, type) {
    const ext = /jpeg/i.test(type) ? 'jpg' : (/webp/i.test(type) ? 'webp' : 'png');
    return `mailab-${String(recordId).replace(/[^a-z0-9]/gi, '').slice(-12)}-${Date.now()}.${ext}`;
  }

  function normalizeShareUrl(value) {
    try {
      const url = new URL(String(value || '').trim());
      if (url.protocol !== 'https:' || url.hostname !== 'labs.google') return '';
      const match = url.pathname.match(SHARE_PATH);
      return match ? `https://labs.google/fx/tools/flow/shared/video/${match[1].toLowerCase()}` : '';
    } catch { return ''; }
  }

  async function copyText(value) {
    try { await navigator.clipboard.writeText(value); setNotice('提示词已复制。', 'success'); }
    catch { setNotice('复制失败。', 'error'); }
  }

  function setNotice(text, type = '') {
    els.notice.textContent = text;
    els.notice.className = `notice${type ? ` ${type}` : ''}`;
    els.toast.textContent = text;
    els.toast.hidden = false;
    clearTimeout(els.toast.__timer);
    els.toast.__timer = setTimeout(() => { els.toast.hidden = true; }, type === 'error' ? 8000 : 4000);
  }

  function setPanelOpen(open) {
    els.panel.classList.toggle('hidden', !open);
    els.launcher.style.display = open ? 'none' : 'block';
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

  function restorePosition(value) {
    if (!value || !Number.isFinite(value.left) || !Number.isFinite(value.top)) return;
    els.panel.style.left = `${clamp(value.left, 8, window.innerWidth - 80)}px`;
    els.panel.style.top = `${clamp(value.top, 8, window.innerHeight - 80)}px`;
    els.panel.style.right = 'auto';
  }

  async function persist() {
    return storageSet({ [BATCH_KEY]: { assignee: state.assignee, orders: state.orders } });
  }

  function schedulePersist() {
    clearTimeout(schedulePersist.timer);
    schedulePersist.timer = setTimeout(persist, 250);
  }

  async function api(path, body, timeout = 30000) {
    const response = await Promise.race([
      sendMessage({ type: 'mailab-api', serverUrl: DEFAULT_SERVER_URL, path, body }),
      delay(timeout).then(() => ({ ok: false, error: '后端请求超时' }))
    ]);
    if (!response?.ok) throw new Error(response?.error || '插件后台无响应');
    return response.data;
  }

  function sendMessage(payload) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(payload, (response) => {
        if (chrome.runtime.lastError && !response) return resolve({ ok: false, error: chrome.runtime.lastError.message });
        resolve(response || { ok: false, error: '插件后台无响应' });
      });
    });
  }

  function storageGet(defaults) {
    return new Promise((resolve) => chrome.storage.local.get(defaults, resolve));
  }

  function storageSet(value) {
    return new Promise((resolve) => chrome.storage.local.set(value, resolve));
  }

  function delay(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
  function clamp(value, min, max) { return Math.max(min, Math.min(value, max)); }

  function runShareWorker() {
    if (shareWorkerPromise) return shareWorkerPromise;
    shareWorkerPromise = executeShareWorker().finally(() => { shareWorkerPromise = null; });
    return shareWorkerPromise;
  }

  async function executeShareWorker() {
    await delay(1200);
    const workResponse = await sendMessage({ type: 'MAILAB_GET_SHARE_WORK', url: location.href });
    const work = workResponse?.ok ? workResponse.data : null;
    if (!work) return;
    try {
      const shareUrl = await adapter.captureShareLink();
      const response = await sendMessage({ type: 'MAILAB_SHARE_CAPTURED', editUrl: work.editUrl, shareUrl });
      if (!response?.ok) throw new Error(response?.error || '自动回填提交失败');
    } catch (error) {
      await sendMessage({ type: 'MAILAB_SHARE_FAILED', editUrl: work.editUrl, error: error.message || '自动获取分享链接失败，可手动回填' });
    }
  }
})();
