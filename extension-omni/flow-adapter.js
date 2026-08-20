(() => {
  if (globalThis.MailabFlowAdapter) return;

  const PROJECT_PATH = /^\/fx\/tools\/flow\/project\/[0-9a-f-]{36}\/?$/i;
  const EDIT_PATH = /^\/fx\/tools\/flow\/project\/[0-9a-f-]{36}\/edit\/[0-9a-f-]{36}\/?$/i;
  const EDIT_LINK = /\/fx\/tools\/flow\/project\/[0-9a-f-]{36}\/edit\/[0-9a-f-]{36}\/?$/i;

  function cleanText(element) {
    return String(element?.innerText || element?.textContent || '').trim().replace(/\s+/g, ' ');
  }

  function isVisible(element) {
    if (!element || !element.isConnected) return false;
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
  }

  function visibleElements(selector, root = document) {
    return [...root.querySelectorAll(selector)].filter(isVisible);
  }

  function findButton(predicate, root = document) {
    return visibleElements('button,[role="button"]', root).find((element) => predicate(cleanText(element), element)) || null;
  }

  function isSamePageMessage(event) {
    const sameOrigin = event.origin === window.location.origin
      || (window.location.origin === 'null' && event.origin === '');
    return event.source === window && sameOrigin;
  }

  function pageAction(action, element, value = '', timeout = 2500) {
    if (!element?.isConnected) return Promise.reject(new Error('Flow 操作目标已经失效'));
    const id = `mailab-action-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    element.setAttribute('data-mailab-action-id', id);
    const targetOrigin = window.location.origin === 'null' ? '*' : window.location.origin;
    return new Promise((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timer);
        window.removeEventListener('message', onMessage);
        if (element.getAttribute('data-mailab-action-id') === id) element.removeAttribute('data-mailab-action-id');
      };
      const onMessage = (event) => {
        if (!isSamePageMessage(event)) return;
        if (event.data?.source !== 'mailab-omni-page' || event.data?.type !== 'MAILAB_FLOW_ACTION_RESULT' || event.data?.id !== id) return;
        cleanup();
        if (event.data.ok) resolve(event.data.value);
        else reject(new Error(event.data.error || 'Flow 页面操作失败'));
      };
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error('Flow 页面操作没有回执'));
      }, timeout);
      window.addEventListener('message', onMessage);
      window.postMessage({ source: 'mailab-omni-extension', type: 'MAILAB_FLOW_ACTION', id, action, value }, targetOrigin);
    });
  }

  function pointerClick(element) {
    return pageAction('click', element);
  }

  async function clickButton(predicate, root = document) {
    const button = findButton(predicate, root);
    if (!button) return false;
    await pointerClick(button);
    return true;
  }

  function waitFor(check, { timeout = 15000, interval = 160, message = '等待 Flow 页面响应超时' } = {}) {
    const startedAt = Date.now();
    return new Promise((resolve, reject) => {
      const run = async () => {
        try {
          const value = await check();
          if (value) return resolve(value);
        } catch {}
        if (Date.now() - startedAt >= timeout) return reject(new Error(message));
        setTimeout(run, interval);
      };
      run();
    });
  }

  function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function clickUntil(getTarget, confirm, {
    attempts = 3,
    timeout = 2200,
    interval = 120,
    message = 'Flow 页面没有响应点击'
  } = {}) {
    let lastError = null;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try {
        const target = typeof getTarget === 'function' ? getTarget() : getTarget;
        if (!target?.isConnected) throw new Error('Flow 操作目标已经失效');
        await pointerClick(target);
        return await waitFor(confirm, { timeout, interval, message });
      } catch (error) {
        lastError = error;
        if (attempt + 1 < attempts) await delay(180);
      }
    }
    throw new Error(message || lastError?.message || 'Flow 页面操作失败');
  }

  function normalizedText(value) {
    const text = value?.nodeType ? (value.innerText || value.textContent || '') : value;
    return String(text || '').replace(/[\u200b\ufeff]/g, '').replace(/\s+/g, ' ').trim();
  }

  function getComposer() {
    return visibleElements('[contenteditable="true"][data-slate-editor]')[0]
      || visibleElements('[contenteditable="true"][role="textbox"]').find((element) => element.hasAttribute('data-slate-editor'))
      || visibleElements('[contenteditable="true"][role="textbox"]')[0]
      || null;
  }

  function getCreateButton() {
    return findButton((text) => /(^|\s)arrow_forward\s+Create$/i.test(text));
  }

  function getSettingsButton() {
    return findButton((text) => /^(Image|Video)(\s*·|\s)/i.test(text) && /x[1-4]\b/i.test(text));
  }

  function getParameterMenu() {
    const menu = visibleElements('[role="menu"]')
      .find((element) => /\bVideo\b/i.test(cleanText(element)) && /\b(?:Ingredients|Frames)\b/i.test(cleanText(element)))
      || null;
    if (menu) return menu;
    const tabs = visibleElements('[role="tab"]');
    const video = tabs.find((element) => /(?:^|\s)Video$/i.test(cleanText(element)));
    const ingredients = tabs.find((element) => /(?:^|\s)(?:Ingredients|Frames)$/i.test(cleanText(element)));
    let ancestor = video;
    for (let depth = 0; ancestor && depth < 7; depth += 1, ancestor = ancestor.parentElement) {
      if (ingredients && ancestor.contains(ingredients) && isVisible(ancestor)) return ancestor;
    }
    return null;
  }

  async function clearComposer() {
    const clear = findButton((text) => /Clear prompt/i.test(text));
    if (clear) {
      await clickUntil(
        () => findButton((text) => /Clear prompt/i.test(text)),
        () => {
          const editor = getComposer();
          const value = cleanText(editor).replace(/What do you want to create\?/i, '').trim();
          return editor && !value;
        },
        { timeout: 1800, message: 'Flow 提示区清理失败' }
      );
      return;
    }
    const editor = getComposer();
    if (!editor) throw new Error('找不到 Flow 提示词输入框');
    const value = cleanText(editor).replace(/What do you want to create\?/i, '').trim();
    if (value) throw new Error('Flow 提示区已有内容，请先点击 Clear prompt');
  }

  async function ensureOmniSettings() {
    let settings = getSettingsButton();
    if (!settings) throw new Error('找不到 Flow 视频参数按钮，请先回到项目 All Media 页面');
    let menu = getParameterMenu();
    if (!menu) {
      menu = await clickUntil(
        () => getSettingsButton(),
        () => getParameterMenu(),
        { timeout: 1800, message: 'Flow 参数菜单打开失败' }
      );
    }

    await clickButton((text, element) => /(?:^|\s)Video$/i.test(text) && ['tab', 'button'].includes(element.getAttribute('role') || element.tagName.toLowerCase()), menu);
    await delay(180);
    menu = getParameterMenu() || menu;
    await clickButton((text) => /(?:^|\s)Ingredients$/i.test(text), menu);
    await delay(180);
    menu = getParameterMenu() || menu;
    await clickButton((text) => /^x1$/i.test(text), menu);
    await delay(180);

    if (!/Omni\s*(Flash)?/i.test(cleanText(document.body))) {
      const model = findButton((text) => /arrow_drop_down/i.test(text) && /(Veo|Video|Flash|Quality|Fast)/i.test(text));
      if (model) await pointerClick(model);
      const omni = await waitFor(
        () => findButton((text) => /^Omni(?:\s+Flash)?$/i.test(text) || /Omni\s+Flash/i.test(text)),
        { timeout: 4000, message: '当前没有找到 Omni Flash 模型，请手动切换后重试' }
      );
      await pointerClick(omni);
    }

    settings = getSettingsButton() || settings;
    if (getParameterMenu()) {
      await clickUntil(
        () => getSettingsButton() || settings,
        () => !getParameterMenu(),
        { attempts: 2, timeout: 1200, message: 'Flow 参数菜单关闭失败' }
      );
    }
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
    await delay(260);
    settings = getSettingsButton();
    const summary = cleanText(settings);
    if (!/^Video/i.test(summary) || !/x1\b/i.test(summary)) {
      throw new Error('请把 Flow 设置为 Video / Ingredients / x1 后重试');
    }
    return summary;
  }

  function setFiles(input, file) {
    const transfer = new DataTransfer();
    transfer.items.add(file);
    input.files = transfer.files;
    input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    input.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
  }

  async function openMediaPicker() {
    const button = findButton((text) => /^add_2\s+Create$/i.test(text));
    if (!button) throw new Error('找不到 Flow 素材添加按钮');
    await clickUntil(
      () => findButton((text) => /^add_2\s+Create$/i.test(text)),
      () => visibleElements('[role="dialog"]').find((element) => /Add to Prompt/i.test(cleanText(element))) || visibleElements('[role="option"]')[0],
      { timeout: 1800, message: 'Flow 素材选择器打开失败' }
    );
  }

  async function uploadAndAttach(blob, filename) {
    const input = [...document.querySelectorAll('input[type="file"]')]
      .find((element) => !element.accept || /image/i.test(element.accept));
    if (!input) throw new Error('找不到 Flow 图片上传控件');
    const type = blob.type && /^image\//i.test(blob.type) ? blob.type : 'image/png';
    const file = new File([blob], filename, { type, lastModified: Date.now() });
    setFiles(input, file);

    await openMediaPicker();
    const option = await waitFor(() => visibleElements('[role="option"]')
      .find((element) => cleanText(element).includes(filename)), {
      timeout: 90000,
      interval: 400,
      message: '图片上传超时，请检查 Flow 网络或手动上传'
    });
    await clickUntil(
      () => option.isConnected ? option : visibleElements('[role="option"]').find((element) => cleanText(element).includes(filename)),
      () => {
        const current = option.isConnected ? option : visibleElements('[role="option"]').find((element) => cleanText(element).includes(filename));
        return current?.getAttribute('aria-selected') === 'true' ? current : null;
      },
      { timeout: 1800, message: '图片已上传，但无法加入 Flow 提示区' }
    );
    const picker = option.closest('[role="dialog"]');
    await clickUntil(
      () => findButton((text) => /^Add to Prompt$/i.test(text)),
      () => {
        const closed = !picker?.isConnected || !isVisible(picker);
        const confirmed = findButton((text) => /^cancel$/i.test(text)) || findButton((text) => /Clear prompt/i.test(text));
        return closed && (confirmed || getComposer());
      },
      { timeout: 2600, message: 'Flow 没有确认参考图片' }
    );
  }

  async function setSlatePrompt(prompt) {
    const value = String(prompt || '').trim();
    if (!value) throw new Error('当前任务没有提示词');
    const signature = normalizedText(value).slice(0, 48);
    let written = false;
    for (let attempt = 0; attempt < 3 && !written; attempt += 1) {
      const editor = await waitFor(() => getComposer(), {
        timeout: 5000,
        message: '找不到 Flow 提示词输入框'
      });
      if (normalizedText(editor).includes(signature)) {
        written = true;
        break;
      }
      try {
        await pageAction('set-prompt', editor, value, 3500);
        await waitFor(() => normalizedText(getComposer()).includes(signature), {
          timeout: 2200,
          message: 'Flow 没有识别插件写入的提示词'
        });
        written = true;
      } catch (error) {
        if (attempt === 2) throw new Error('Flow 没有识别插件写入的提示词');
        await delay(220);
      }
    }
    if (!written) throw new Error('Flow 没有识别插件写入的提示词');
    await waitFor(() => getCreateButton()?.getAttribute('aria-disabled') !== 'true', {
      timeout: 5000,
      message: 'Flow 生成按钮仍不可用，请检查图片或模型设置'
    });
  }

  function editLinks() {
    return visibleElements('a[href*="/edit/"]')
      .map((anchor) => anchor.href)
      .filter((href) => EDIT_LINK.test(new URL(href).pathname));
  }

  function generationCards() {
    return visibleElements('[role="button"]')
      .filter((element) => {
        if (element.closest('#mailab-omni-batch-host,[role="dialog"]')) return false;
        const rect = element.getBoundingClientRect();
        const hasMedia = element.querySelector('a[href*="/edit/"],img[alt="Video thumbnail"],img[alt="Generated image"],video');
        const status = /Generating|Queued|Failed|Retry|%/.test(cleanText(element));
        return rect.width >= 120 && rect.height >= 120 && (hasMedia || status);
      });
  }

  function startGeneration({ reservedUrls = new Set() } = {}) {
    const create = getCreateButton();
    if (!create || create.getAttribute('aria-disabled') === 'true') throw new Error('Flow 生成按钮不可用');
    const beforeCards = new Set(generationCards());
    const beforeUrls = new Set(editLinks());
    let submittedResolve;
    const submitted = new Promise((resolve) => { submittedResolve = resolve; });
    const result = (async () => {
      await pointerClick(create);
      let root = null;
      try {
        root = await waitFor(() => generationCards().find((element) => !beforeCards.has(element)), {
          timeout: 12000,
          interval: 120,
          message: 'Flow 没有创建生成卡片'
        });
      } finally {
        submittedResolve(Boolean(root));
      }
      const slot = root?.parentElement || root;
      const url = await waitFor(() => {
        const local = slot?.isConnected ? slot.querySelector('a[href*="/edit/"]')?.href : '';
        if (local && EDIT_LINK.test(new URL(local).pathname) && !reservedUrls.has(local)) return local;
        return editLinks().find((href) => !beforeUrls.has(href) && !reservedUrls.has(href)) || '';
      }, {
        timeout: 30 * 60 * 1000,
        interval: 1200,
        message: '等待 Flow 视频生成超时，可稍后点击重新监控'
      });
      reservedUrls.add(url);
      return url;
    })();
    return { submitted, result };
  }

  async function captureShareLink() {
    await waitFor(() => findButton((text) => /^share\s+Share$/i.test(text) || /^Share$/i.test(text)), {
      timeout: 45000,
      message: 'Flow 结果页没有出现 Share 按钮'
    });
    let dialog = visibleElements('[role="dialog"]')[0] || null;
    if (!dialog) {
      dialog = await clickUntil(
        () => findButton((text) => /^share\s+Share$/i.test(text) || /^Share$/i.test(text)),
        () => visibleElements('[role="dialog"]')[0],
        { timeout: 2200, message: 'Flow 分享弹窗打开失败' }
      );
    }
    const includeInputs = dialog.querySelector('[role="switch"][aria-checked="true"]');
    if (includeInputs) {
      await clickUntil(
        () => visibleElements('[role="dialog"]')[0]?.querySelector('[role="switch"][aria-checked="true"]'),
        () => {
          const currentSwitch = visibleElements('[role="dialog"]')[0]?.querySelector('[role="switch"]');
          return !currentSwitch || currentSwitch.getAttribute('aria-checked') === 'false';
        },
        { timeout: 1800, message: 'Flow 分享输入项关闭失败' }
      );
    }
    let capturedValue = '';
    const onMessage = (event) => {
      if (!isSamePageMessage(event)) return;
      if (event.data?.source !== 'mailab-omni-page' || event.data?.type !== 'MAILAB_FLOW_SHARE_LINK') return;
      capturedValue = normalizeShareUrl(event.data.value);
    };
    window.addEventListener('message', onMessage);
    try {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const copy = await waitFor(() => {
          const currentDialog = visibleElements('[role="dialog"]')[0];
          const button = currentDialog && findButton((text) => /Copy link/i.test(text), currentDialog);
          return button && !button.disabled && button.getAttribute('aria-disabled') !== 'true' ? button : null;
        }, {
          timeout: 5000,
          message: 'Flow 分享弹窗没有 Copy link'
        });
        await pointerClick(copy);
        try {
          const shareUrl = await waitFor(async () => {
            if (capturedValue) return capturedValue;
            try {
              return normalizeShareUrl(await navigator.clipboard?.readText?.());
            } catch {
              return '';
            }
          }, { timeout: 2600, interval: 180, message: '没有捕获到 Flow 分享链接' });
          if (shareUrl) return shareUrl;
        } catch (error) {
          if (attempt === 2) throw error;
          await delay(220);
        }
      }
      throw new Error('没有捕获到 Flow 分享链接');
    } finally {
      window.removeEventListener('message', onMessage);
    }
  }

  function normalizeShareUrl(value) {
    const text = String(value || '').trim();
    return /^https:\/\/labs\.google\/fx\/tools\/flow\/shared\/video\/[0-9a-f-]{36}\/?$/i.test(text)
      ? text.replace(/\/$/, '')
      : '';
  }

  globalThis.MailabFlowAdapter = {
    PROJECT_PATH,
    EDIT_PATH,
    cleanText,
    isProjectPage: () => PROJECT_PATH.test(location.pathname),
    isEditPage: () => EDIT_PATH.test(location.pathname),
    clearComposer,
    ensureOmniSettings,
    uploadAndAttach,
    setSlatePrompt,
    startGeneration,
    captureShareLink,
    editLinks
  };
})();
