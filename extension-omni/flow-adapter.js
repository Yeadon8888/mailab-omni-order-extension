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

  function clickButton(predicate, root = document) {
    const button = findButton(predicate, root);
    if (!button) return false;
    button.click();
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

  function getComposer() {
    return visibleElements('[contenteditable="true"][role="textbox"]').find((element) => element.hasAttribute('data-slate-editor'))
      || visibleElements('[contenteditable="true"][role="textbox"]')[0]
      || null;
  }

  function getCreateButton() {
    return findButton((text) => /(^|\s)arrow_forward\s+Create$/i.test(text));
  }

  function getSettingsButton() {
    return findButton((text) => /^(Image|Video)(\s*·|\s)/i.test(text) && /x[1-4]\b/i.test(text));
  }

  async function clearComposer() {
    const clear = findButton((text) => /Clear prompt/i.test(text));
    if (clear) {
      clear.click();
      await waitFor(() => {
        const editor = getComposer();
        const value = cleanText(editor).replace(/What do you want to create\?/i, '').trim();
        return editor && !value;
      }, { timeout: 5000, message: 'Flow 提示区清理失败' });
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
    settings.click();
    await waitFor(() => {
      const body = cleanText(document.body);
      return /\bVideo\b/.test(body) && (/Ingredients/.test(body) || /Frames/.test(body));
    }, { timeout: 5000, message: 'Flow 参数菜单打开失败' });

    clickButton((text, element) => /^Video$/i.test(text) && ['tab', 'button'].includes(element.getAttribute('role') || element.tagName.toLowerCase()));
    await new Promise((resolve) => setTimeout(resolve, 180));
    clickButton((text) => /^Ingredients$/i.test(text));
    await new Promise((resolve) => setTimeout(resolve, 180));
    clickButton((text) => /^x1$/i.test(text));
    await new Promise((resolve) => setTimeout(resolve, 180));

    if (!/Omni\s*(Flash)?/i.test(cleanText(document.body))) {
      const model = findButton((text) => /arrow_drop_down/i.test(text) && /(Veo|Video|Flash|Quality|Fast)/i.test(text));
      model?.click();
      const omni = await waitFor(
        () => findButton((text) => /^Omni(?:\s+Flash)?$/i.test(text) || /Omni\s+Flash/i.test(text)),
        { timeout: 4000, message: '当前没有找到 Omni Flash 模型，请手动切换后重试' }
      );
      omni.click();
    }

    settings.click();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 260));
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

  function openMediaPicker() {
    const button = findButton((text) => /^add_2\s+Create$/i.test(text));
    if (!button) throw new Error('找不到 Flow 素材添加按钮');
    button.click();
  }

  async function uploadAndAttach(blob, filename) {
    const input = [...document.querySelectorAll('input[type="file"]')]
      .find((element) => !element.accept || /image/i.test(element.accept));
    if (!input) throw new Error('找不到 Flow 图片上传控件');
    const type = blob.type && /^image\//i.test(blob.type) ? blob.type : 'image/png';
    const file = new File([blob], filename, { type, lastModified: Date.now() });
    setFiles(input, file);

    openMediaPicker();
    const option = await waitFor(() => visibleElements('[role="option"]')
      .find((element) => cleanText(element).includes(filename)), {
      timeout: 90000,
      interval: 400,
      message: '图片上传超时，请检查 Flow 网络或手动上传'
    });
    option.click();
    const add = await waitFor(() => findButton((text) => /^Add to Prompt$/i.test(text)), {
      timeout: 5000,
      message: '图片已上传，但无法加入 Flow 提示区'
    });
    add.click();
    await waitFor(() => findButton((text) => /^cancel$/i.test(text)) || findButton((text) => /Clear prompt/i.test(text)), {
      timeout: 8000,
      message: 'Flow 没有确认参考图片'
    });
  }

  async function setSlatePrompt(prompt) {
    const value = String(prompt || '').trim();
    if (!value) throw new Error('当前任务没有提示词');
    const editor = getComposer();
    if (!editor) throw new Error('找不到 Flow 提示词输入框');
    editor.focus();
    const target = editor.querySelector('[data-slate-zero-width]')?.firstChild
      || editor.querySelector('[data-slate-string]')?.firstChild
      || editor.firstChild;
    if (!target) throw new Error('Flow 提示词输入框尚未准备好');
    const selection = getSelection();
    const range = document.createRange();
    range.setStart(target, 0);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
    document.dispatchEvent(new Event('selectionchange', { bubbles: true }));
    editor.dispatchEvent(new InputEvent('beforeinput', {
      bubbles: true,
      cancelable: true,
      composed: true,
      inputType: 'insertText',
      data: value
    }));
    await waitFor(() => cleanText(getComposer()).includes(value.slice(0, Math.min(80, value.length))), {
      timeout: 5000,
      message: 'Flow 没有识别插件写入的提示词'
    });
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
      create.click();
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
    const share = await waitFor(() => findButton((text) => /^share\s+Share$/i.test(text) || /^Share$/i.test(text)), {
      timeout: 45000,
      message: 'Flow 结果页没有出现 Share 按钮'
    });
    share.click();
    const dialog = await waitFor(() => visibleElements('[role="dialog"]')[0], {
      timeout: 8000,
      message: 'Flow 分享弹窗打开失败'
    });
    dialog.querySelector('[role="switch"][aria-checked="true"]')?.click();
    const captured = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        window.removeEventListener('message', onMessage);
        reject(new Error('没有捕获到 Flow 分享链接'));
      }, 10000);
      const onMessage = (event) => {
        if (event.source !== window || event.origin !== window.location.origin) return;
        if (event.data?.source !== 'mailab-omni-page' || event.data?.type !== 'MAILAB_FLOW_SHARE_LINK') return;
        clearTimeout(timer);
        window.removeEventListener('message', onMessage);
        resolve(String(event.data.value || ''));
      };
      window.addEventListener('message', onMessage);
    });
    const copy = await waitFor(() => findButton((text) => /Copy link/i.test(text), dialog), {
      timeout: 5000,
      message: 'Flow 分享弹窗没有 Copy link'
    });
    copy.click();
    return captured;
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
