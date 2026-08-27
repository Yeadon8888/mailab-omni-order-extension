const STORAGE_KEY = 'mailab_public_order_settings';
const DEFAULT_SERVER_URL = 'https://genvideo.mailab.top';

const els = {
  toast: document.getElementById('toast'),
  serverInput: document.getElementById('serverInput'),
  assigneeInput: document.getElementById('assigneeInput'),
  claimButton: document.getElementById('claimButton'),
  refreshStatsButton: document.getElementById('refreshStatsButton'),
  pendingCount: document.getElementById('pendingCount'),
  poolDetail: document.getElementById('poolDetail'),
  status: document.getElementById('status'),
  taskMeta: document.getElementById('taskMeta'),
  copyPromptButton: document.getElementById('copyPromptButton'),
  copyImageButton: document.getElementById('copyImageButton'),
  promptText: document.getElementById('promptText'),
  imageEmpty: document.getElementById('imageEmpty'),
  taskImage: document.getElementById('taskImage'),
  watermarkInput: document.getElementById('watermarkInput'),
  completeButton: document.getElementById('completeButton'),
  result: document.getElementById('result')
};

const state = {
  settings: {
    serverUrl: DEFAULT_SERVER_URL,
    assignee: ''
  },
  order: null
};

els.claimButton.addEventListener('click', claimOrder);
els.refreshStatsButton.addEventListener('click', () => loadStats({ manual: true }));
els.copyPromptButton.addEventListener('click', copyPrompt);
els.copyImageButton.addEventListener('click', copyImage);
els.completeButton.addEventListener('click', completeOrder);
els.serverInput.addEventListener('change', saveSettings);
els.assigneeInput.addEventListener('change', saveSettings);

loadSettings();
renderOrder();
setTimeout(loadStats, 300);

function loadSettings() {
  chrome.storage.local.get({ [STORAGE_KEY]: {} }, (items) => {
    const settings = items[STORAGE_KEY] || {};
    state.settings.serverUrl = normalizeServerUrl(settings.serverUrl || DEFAULT_SERVER_URL);
    state.settings.assignee = String(settings.assignee || '').trim();
    els.serverInput.value = state.settings.serverUrl;
    els.assigneeInput.value = state.settings.assignee;
    loadStats();
  });
}

function saveSettings() {
  state.settings.serverUrl = normalizeServerUrl(els.serverInput.value);
  state.settings.assignee = String(els.assigneeInput.value || '').trim();
  chrome.storage.local.set({ [STORAGE_KEY]: { ...state.settings } });
  return state.settings;
}

async function claimOrder() {
  const settings = saveSettings();
  if (!settings.serverUrl) {
    setStatus('请先填写公网后端地址。', 'error');
    return;
  }
  if (!settings.assignee) {
    setStatus('请先填写接单人。', 'error');
    return;
  }

  setBusy(els.claimButton, '接单中...', true);
  setStatus('正在接单...', 'warn');
  try {
    const data = await mailabApi('/api/claim', { assignee: settings.assignee, platform: '豆包' });
    if (!data.ok) {
      setStatus(data.error || '暂无可接任务。', 'error');
      return;
    }
    state.order = data;
    renderOrder();
    setStatus('接单成功，素材已同步。', 'success');
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
    els.completeButton.disabled = true;
    return;
  }

  els.taskMeta.textContent = `接单人：${order.assignee || state.settings.assignee} | 记录：${order.recordId || ''}`;
  els.promptText.value = order.prompt || '';
  const imageUrl = normalizeHttpUrl(order.imageUrl || '');
  els.copyPromptButton.disabled = !order.prompt;
  els.copyImageButton.disabled = !imageUrl;
  els.completeButton.disabled = false;
  els.watermarkInput.value = '';
  clearResult();

  if (imageUrl) {
    els.imageEmpty.textContent = '接单后显示图片';
    els.taskImage.dataset.fallbackTried = '';
    els.taskImage.onerror = () => {
      if (!els.taskImage.dataset.fallbackTried) {
        els.taskImage.dataset.fallbackTried = '1';
        els.taskImage.src = proxyImageUrl(imageUrl);
        return;
      }
      els.taskImage.hidden = true;
      els.imageEmpty.hidden = false;
      els.imageEmpty.textContent = '图片加载失败，可点击复制图片';
    };
    els.taskImage.src = imageUrl;
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
  if (!prompt) {
    setStatus('没有提示词可复制。', 'error');
    return;
  }
  try {
    await navigator.clipboard.writeText(prompt);
    setStatus('提示词已复制。', 'success');
  } catch {
    setStatus('复制提示词失败。', 'error');
  }
}

async function copyImage() {
  const imageUrl = normalizeHttpUrl(state.order?.imageUrl || '');
  if (!imageUrl) {
    setStatus('没有图片可复制。', 'error');
    return;
  }
  try {
    const proxyUrl = proxyImageUrl(imageUrl);
    const response = await fetch(proxyUrl);
    if (!response.ok) throw new Error('图片读取失败');
    const blob = await response.blob();
    await navigator.clipboard.write([
      new ClipboardItem({ [blob.type || 'image/png']: blob })
    ]);
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
  if (!state.order?.recordId || !state.order?.lockId) {
    setStatus('请先接单。', 'error');
    return;
  }
  const submittedUrl = normalizeHttpUrl(els.watermarkInput.value || '');
  if (!submittedUrl) {
    setResult('请输入有效的视频链接。');
    setStatus('视频链接无效，请检查后再试。', 'error');
    return;
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
    renderOrder();
    loadStats();
  } catch (error) {
    setResult(error.message || '同步失败，任务已回滚。');
    setStatus(error.message || '同步失败，任务已回滚。', 'error', { duration: 9000 });
  } finally {
    if (state.order) {
      setBusy(els.completeButton, '同步视频并完成', false);
    } else {
      els.completeButton.textContent = '同步视频并完成';
    }
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

async function mailabApi(path, body) {
  const response = await sendMessage({
    type: 'mailab-api',
    serverUrl: state.settings.serverUrl,
    path,
    body
  });
  if (!response?.ok) {
    throw new Error(response?.error || '后端请求失败，请确认公网服务已启动。');
  }
  return response.data;
}

async function loadStats(options = {}) {
  const manual = Boolean(options.manual);
  const settings = saveSettings();
  if (!settings.serverUrl) {
    els.pendingCount.textContent = '--';
    els.poolDetail.textContent = '填写后端地址后显示';
    if (manual) {
      setStatus('请先填写公网后端地址。', 'error');
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
  if (url) {
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
  els.toast.__timer = setTimeout(() => {
    els.toast.hidden = true;
  }, options.duration || (inferredType === 'error' ? 8000 : inferredType === 'warn' ? 5000 : 4200));
}

function setBusy(button, text, busy) {
  button.disabled = busy;
  button.textContent = text;
}

function normalizeServerUrl(value) {
  return String(value || '').trim().replace(/\/+$/, '');
}

function normalizeHttpUrl(value) {
  const match = String(value || '').trim().match(/https?:\/\/[^\s"'<>]+/i);
  if (!match) return '';
  try {
    return new URL(match[0].replace(/\\u0026/g, '&')).toString();
  } catch {
    return '';
  }
}

function proxyImageUrl(imageUrl) {
  return `${state.settings.serverUrl}/api/image-proxy?url=${encodeURIComponent(imageUrl)}`;
}

function normalizeDoubaoUrl(value) {
  const text = String(value || '').trim();
  const match = text.match(/https:\/\/www\.doubao\.com\/(?:thread\/[^\s"'<>]+|video-sharing\?[^\s"'<>]+)/);
  if (!match) return '';
  try {
    const url = new URL(match[0].replace(/\\u0026/g, '&'));
    if (url.pathname.startsWith('/thread/')) {
      return `${url.origin}${url.pathname}`;
    }
    if (url.pathname.includes('/video-sharing') && url.searchParams.get('share_id') && (url.searchParams.get('video_id') || url.searchParams.get('vid'))) {
      return url.toString();
    }
  } catch {
    return '';
  }
  return '';
}
