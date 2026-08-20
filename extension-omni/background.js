const DEFAULT_SERVER_URL = 'https://genvideo.mailab.top';
const BATCH_KEY = 'mailab_omni_batch_state_v2';
const SHARE_WORK_KEY = 'mailab_omni_share_work_v1';
const FLOW_SHARE_PATH = /^\/fx\/tools\/flow\/shared\/video\/([0-9a-f-]{36})\/?$/i;
let storageQueue = Promise.resolve();

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender)
    .then((data) => sendResponse({ ok: true, data }))
    .catch((error) => sendResponse({ ok: false, error: error.message || '插件后台处理失败' }));
  return true;
});

chrome.action.onClicked.addListener((tab) => {
  if (!tab?.id || !String(tab.url || '').startsWith('https://labs.google/fx/tools/flow/')) return;
  chrome.tabs.sendMessage(tab.id, { type: 'MAILAB_OMNI_TOGGLE' }).catch(() => {});
});

async function handleMessage(message, sender) {
  if (message?.type === 'mailab-api') return callMailabApi(message);
  if (message?.type === 'MAILAB_OPEN_SHARE_WORK') return openShareWork(message.work, sender.tab?.id);
  if (message?.type === 'MAILAB_GET_SHARE_WORK') return getShareWork(message.url, sender.tab?.id);
  if (message?.type === 'MAILAB_SHARE_CAPTURED') return completeShareWork(message, sender.tab?.id);
  if (message?.type === 'MAILAB_SHARE_FAILED') return failShareWork(message, sender.tab?.id);
  if (message?.type === 'MAILAB_PATCH_ORDER') return patchOrder(message.recordId, message.patch || {});
  throw new Error('未知的插件后台消息');
}

async function openShareWork(rawWork, sourceTabId) {
  const work = normalizeShareWork(rawWork);
  if (!work) throw new Error('分享任务参数无效');
  if (Number.isInteger(sourceTabId)) work.sourceTabId = sourceTabId;
  const stored = await chrome.storage.local.get({ [SHARE_WORK_KEY]: {} });
  const jobs = stored[SHARE_WORK_KEY] || {};
  jobs[work.editUrl] = work;
  await chrome.storage.local.set({ [SHARE_WORK_KEY]: jobs });
  const createOptions = { url: work.editUrl, active: true };
  if (work.sourceTabId) createOptions.openerTabId = work.sourceTabId;
  const tab = await chrome.tabs.create(createOptions);
  jobs[work.editUrl].tabId = tab.id;
  await chrome.storage.local.set({ [SHARE_WORK_KEY]: jobs });
  await wakeShareWorker(tab.id);
  return { opened: true, tabId: tab.id };
}

async function wakeShareWorker(tabId) {
  let lastError = null;
  for (let attempt = 0; attempt < 12; attempt += 1) {
    try {
      await chrome.tabs.sendMessage(tabId, { type: 'MAILAB_RUN_SHARE_WORKER' });
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 350));
    }
  }
  throw new Error(lastError?.message || '自动分享页没有响应');
}

async function getShareWork(rawUrl, tabId) {
  const editUrl = normalizeEditUrl(rawUrl);
  if (!editUrl) return null;
  const stored = await chrome.storage.local.get({ [SHARE_WORK_KEY]: {} });
  const work = stored[SHARE_WORK_KEY]?.[editUrl] || null;
  if (!work) return null;
  if (work.tabId && tabId && work.tabId !== tabId) return null;
  return work;
}

async function completeShareWork(message, tabId) {
  const editUrl = normalizeEditUrl(message.editUrl);
  const shareUrl = normalizeFlowShareUrl(message.shareUrl);
  if (!editUrl || !shareUrl) throw new Error('Flow 分享链接无效');
  const stored = await chrome.storage.local.get({ [SHARE_WORK_KEY]: {} });
  const jobs = stored[SHARE_WORK_KEY] || {};
  const work = jobs[editUrl];
  if (!work || (work.tabId && tabId && work.tabId !== tabId)) throw new Error('分享任务已经失效');

  const data = await callMailabApi({
    serverUrl: work.serverUrl || DEFAULT_SERVER_URL,
    path: '/api/omni/complete',
    body: {
      recordId: work.recordId,
      lockId: work.lockId,
      assignee: work.assignee,
      flowShareUrl: shareUrl
    }
  });
  if (!data.ok || !data.jobId) {
    await patchOrder(work.recordId, { state: 'error', message: data.error || 'R2 转存任务创建失败', shareUrl });
    throw new Error(data.error || 'R2 转存任务创建失败');
  }

  await patchOrder(work.recordId, {
    state: 'processing',
    message: '已取得 Flow 分享链接，正在转存 R2',
    shareUrl,
    jobId: data.jobId
  });
  delete jobs[editUrl];
  await chrome.storage.local.set({ [SHARE_WORK_KEY]: jobs });
  await restoreSourceTab(work, tabId);
  return { jobId: data.jobId, shareUrl };
}

async function failShareWork(message, tabId) {
  const editUrl = normalizeEditUrl(message.editUrl);
  const stored = await chrome.storage.local.get({ [SHARE_WORK_KEY]: {} });
  const jobs = stored[SHARE_WORK_KEY] || {};
  const work = editUrl ? jobs[editUrl] : null;
  if (work) {
    await patchOrder(work.recordId, { state: 'error', message: String(message.error || '自动获取分享链接失败，可手动回填') });
    delete jobs[editUrl];
    await chrome.storage.local.set({ [SHARE_WORK_KEY]: jobs });
  }
  await restoreSourceTab(work, tabId);
  return { cleared: Boolean(work) };
}

async function restoreSourceTab(work, shareTabId) {
  if (work?.sourceTabId) await chrome.tabs.update(work.sourceTabId, { active: true }).catch(() => {});
  if (shareTabId) setTimeout(() => chrome.tabs.remove(shareTabId).catch(() => {}), 900);
}

function patchOrder(recordId, patch) {
  storageQueue = storageQueue.then(async () => {
    const stored = await chrome.storage.local.get({ [BATCH_KEY]: { assignee: '', orders: [] } });
    const batch = stored[BATCH_KEY] || { assignee: '', orders: [] };
    batch.orders = (batch.orders || []).map((order) => order.recordId === recordId
      ? { ...order, ...patch, updatedAt: Date.now() }
      : order);
    await chrome.storage.local.set({ [BATCH_KEY]: batch });
    return batch.orders.find((order) => order.recordId === recordId) || null;
  });
  return storageQueue;
}

async function callMailabApi(message) {
  const serverUrl = normalizeServerUrl(message.serverUrl || DEFAULT_SERVER_URL);
  const path = String(message.path || '');
  if (!serverUrl) throw new Error('后端地址配置异常');
  if (!/^https:\/\//i.test(serverUrl) && !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/i.test(serverUrl)) {
    throw new Error('公网后端必须使用 HTTPS');
  }
  if (!path.startsWith('/api/')) throw new Error('后端接口路径无效');
  const response = await fetch(`${serverUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(message.body || {})
  });
  const data = await safeJson(response);
  if (!response.ok) return { ok: false, error: data.error || `后端请求失败 HTTP ${response.status}` };
  return data;
}

function normalizeShareWork(value) {
  const editUrl = normalizeEditUrl(value?.editUrl);
  if (!editUrl || !value?.recordId || !value?.lockId || !value?.assignee) return null;
  return {
    editUrl,
    recordId: String(value.recordId),
    lockId: String(value.lockId),
    assignee: String(value.assignee),
    serverUrl: normalizeServerUrl(value.serverUrl || DEFAULT_SERVER_URL),
    createdAt: Date.now()
  };
}

function normalizeEditUrl(value) {
  try {
    const url = new URL(String(value || ''));
    if (url.protocol !== 'https:' || url.hostname !== 'labs.google') return '';
    if (!/^\/fx\/tools\/flow\/project\/[0-9a-f-]{36}\/edit\/[0-9a-f-]{36}\/?$/i.test(url.pathname)) return '';
    return `${url.origin}${url.pathname.replace(/\/$/, '')}`;
  } catch { return ''; }
}

function normalizeFlowShareUrl(value) {
  try {
    const url = new URL(String(value || ''));
    if (url.protocol !== 'https:' || url.hostname !== 'labs.google') return '';
    const match = url.pathname.match(FLOW_SHARE_PATH);
    return match ? `https://labs.google/fx/tools/flow/shared/video/${match[1].toLowerCase()}` : '';
  } catch { return ''; }
}

function normalizeServerUrl(value) {
  return String(value || '').trim().replace(/\/+$/, '');
}

async function safeJson(response) {
  const text = await response.text();
  try { return JSON.parse(text); } catch {
    if (/502\s+Bad\s+Gateway/i.test(text)) return { ok: false, error: '后端网关错误，请联系管理员检查服务。' };
    if (/<html[\s>]|<!doctype\s+html/i.test(text)) return { ok: false, error: `服务器返回 HTML 错误页 HTTP ${response.status}` };
    return { ok: false, error: text.slice(0, 160) || '后端返回异常' };
  }
}
