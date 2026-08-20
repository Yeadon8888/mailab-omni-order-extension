(() => {
  if (window.__mailabOmniPageHookInstalled) return;
  window.__mailabOmniPageHookInstalled = true;

  function postToCurrentPage(message) {
    const targetOrigin = window.location.origin === 'null' ? '*' : window.location.origin;
    window.postMessage(message, targetOrigin);
  }

  function isSamePageMessage(event) {
    const sameOrigin = event.origin === window.location.origin
      || (window.location.origin === 'null' && event.origin === '');
    return event.source === window && sameOrigin;
  }

  function findActionTarget(id) {
    return [...document.querySelectorAll('[data-mailab-action-id]')]
      .find((candidate) => candidate.getAttribute('data-mailab-action-id') === id)
      || null;
  }

  function dispatchPointerClick(element) {
    const rect = element.getBoundingClientRect();
    const common = {
      bubbles: true,
      cancelable: true,
      composed: true,
      view: window,
      button: 0,
      clientX: rect.left + rect.width / 2,
      clientY: rect.top + rect.height / 2
    };
    element.dispatchEvent(new PointerEvent('pointerdown', {
      ...common,
      pointerId: 1,
      pointerType: 'mouse',
      isPrimary: true,
      buttons: 1
    }));
    element.dispatchEvent(new MouseEvent('mousedown', { ...common, buttons: 1 }));
    element.dispatchEvent(new PointerEvent('pointerup', {
      ...common,
      pointerId: 1,
      pointerType: 'mouse',
      isPrimary: true,
      buttons: 0
    }));
    element.dispatchEvent(new MouseEvent('mouseup', { ...common, buttons: 0 }));
    element.dispatchEvent(new MouseEvent('click', { ...common, buttons: 0 }));
  }

  function selectEditorContents(editor) {
    editor.focus();
    const selection = getSelection();
    const range = document.createRange();
    range.selectNodeContents(editor);
    selection.removeAllRanges();
    selection.addRange(range);
    document.dispatchEvent(new Event('selectionchange', { bubbles: true }));
  }

  async function setPrompt(editor, value) {
    selectEditorContents(editor);
    editor.dispatchEvent(new InputEvent('beforeinput', {
      bubbles: true,
      cancelable: true,
      composed: true,
      inputType: 'insertText',
      data: value
    }));
    await new Promise((resolve) => setTimeout(resolve, 80));
    const normalized = String(editor.innerText || editor.textContent || '').replace(/[\u200b\ufeff]/g, '').replace(/\s+/g, ' ').trim();
    const signature = String(value || '').replace(/[\u200b\ufeff]/g, '').replace(/\s+/g, ' ').trim().slice(0, 48);
    if (signature && !normalized.includes(signature)) {
      selectEditorContents(editor);
      document.execCommand('insertText', false, value);
      await new Promise((resolve) => setTimeout(resolve, 80));
    }
    return String(editor.innerText || editor.textContent || '');
  }

  window.addEventListener('message', async (event) => {
    if (!isSamePageMessage(event)) return;
    if (event.data?.source !== 'mailab-omni-extension' || event.data?.type !== 'MAILAB_FLOW_ACTION') return;
    const id = String(event.data.id || '');
    if (!/^mailab-action-[a-z0-9-]+$/i.test(id)) return;
    const action = String(event.data.action || '');
    const element = findActionTarget(id);
    try {
      if (!element?.isConnected) throw new Error('Flow 操作目标已经失效');
      element.removeAttribute('data-mailab-action-id');
      let value = null;
      if (action === 'click') {
        dispatchPointerClick(element);
      } else if (action === 'set-prompt') {
        value = await setPrompt(element, String(event.data.value || ''));
      } else {
        throw new Error('未知的 Flow 页面操作');
      }
      postToCurrentPage({ source: 'mailab-omni-page', type: 'MAILAB_FLOW_ACTION_RESULT', id, ok: true, value });
    } catch (error) {
      element?.removeAttribute('data-mailab-action-id');
      postToCurrentPage({
        source: 'mailab-omni-page',
        type: 'MAILAB_FLOW_ACTION_RESULT',
        id,
        ok: false,
        error: error?.message || 'Flow 页面操作失败'
      });
    }
  });

  function publishShareLink(value) {
    const text = String(value || '').trim();
    if (/^https:\/\/labs\.google\/fx\/tools\/flow\/shared\/video\/[0-9a-f-]{36}\/?$/i.test(text)) {
      postToCurrentPage({ source: 'mailab-omni-page', type: 'MAILAB_FLOW_SHARE_LINK', value: text });
    }
  }

  const clipboard = navigator.clipboard;
  const prototype = clipboard && Object.getPrototypeOf(clipboard);
  if (!prototype) return;
  if (typeof prototype.writeText === 'function' && !prototype.__mailabOriginalWriteText) {
    const originalWriteText = prototype.writeText;
    Object.defineProperty(prototype, '__mailabOriginalWriteText', {
      configurable: false,
      enumerable: false,
      value: originalWriteText
    });
    prototype.writeText = async function mailabCaptureClipboardWrite(value) {
      publishShareLink(value);
      return originalWriteText.call(this, value);
    };
  }
  if (typeof prototype.write === 'function' && !prototype.__mailabOriginalWrite) {
    const originalWrite = prototype.write;
    Object.defineProperty(prototype, '__mailabOriginalWrite', {
      configurable: false,
      enumerable: false,
      value: originalWrite
    });
    prototype.write = async function mailabCaptureClipboardWrite(items) {
      for (const item of items || []) {
        if (!item?.types?.includes?.('text/plain')) continue;
        item.getType('text/plain').then((blob) => blob.text()).then(publishShareLink).catch(() => {});
      }
      return originalWrite.call(this, items);
    };
  }
})();
