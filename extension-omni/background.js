chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== 'mailab-api') {
    return false;
  }
  callMailabApi(message)
    .then((data) => sendResponse({ ok: true, data }))
    .catch((error) => sendResponse({ ok: false, error: error.message || '后端请求失败' }));
  return true;
});

chrome.action.onClicked.addListener((tab) => {
  if (!tab?.id || !String(tab.url || '').startsWith('https://labs.google/fx/tools/flow/')) {
    return;
  }
  chrome.tabs.sendMessage(tab.id, { type: 'MAILAB_OMNI_TOGGLE' }).catch(() => {});
});

async function callMailabApi(message) {
  const serverUrl = normalizeServerUrl(message.serverUrl);
  const path = String(message.path || '');
  if (!serverUrl) {
    throw new Error('后端地址配置异常');
  }
  if (!/^https:\/\//i.test(serverUrl) && !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/i.test(serverUrl)) {
    throw new Error('公网后端必须使用 HTTPS');
  }
  if (!path.startsWith('/api/')) {
    throw new Error('后端接口路径无效');
  }

  const response = await fetch(`${serverUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(message.body || {})
  });
  const data = await safeJson(response);
  if (!response.ok) {
    return { ok: false, error: data.error || `后端请求失败 HTTP ${response.status}` };
  }
  return data;
}

function normalizeServerUrl(value) {
  return String(value || '').trim().replace(/\/+$/, '');
}

async function safeJson(response) {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    if (/502\s+Bad\s+Gateway/i.test(text)) {
      return { ok: false, error: '后端网关错误，请联系管理员检查服务。' };
    }
    if (/<html[\s>]|<!doctype\s+html/i.test(text)) {
      return { ok: false, error: `服务器返回 HTML 错误页 HTTP ${response.status}` };
    }
    return { ok: false, error: text.slice(0, 160) || '后端返回异常' };
  }
}
