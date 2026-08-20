(() => {
  if (window.__mailabOmniPageHookInstalled) return;
  window.__mailabOmniPageHookInstalled = true;

  function postToCurrentPage(message) {
    const targetOrigin = window.location.origin === 'null' ? '*' : window.location.origin;
    window.postMessage(message, targetOrigin);
  }

  window.addEventListener('message', (event) => {
    const sameOrigin = event.origin === window.location.origin
      || (window.location.origin === 'null' && event.origin === '');
    if (event.source !== window || !sameOrigin) return;
    if (event.data?.source !== 'mailab-omni-extension' || event.data?.type !== 'MAILAB_FLOW_POINTER_CLICK') return;
    const id = String(event.data.id || '');
    if (!/^mailab-pointer-[a-z0-9-]+$/i.test(id)) return;
    const element = [...document.querySelectorAll('[data-mailab-pointer-id]')]
      .find((candidate) => candidate.getAttribute('data-mailab-pointer-id') === id);
    if (!element) return;
    element.removeAttribute('data-mailab-pointer-id');
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
  });

  const clipboard = navigator.clipboard;
  const prototype = clipboard && Object.getPrototypeOf(clipboard);
  if (!prototype || typeof prototype.writeText !== 'function' || prototype.__mailabOriginalWriteText) return;
  const originalWriteText = prototype.writeText;
  Object.defineProperty(prototype, '__mailabOriginalWriteText', {
    configurable: false,
    enumerable: false,
    value: originalWriteText
  });
  prototype.writeText = async function mailabCaptureClipboardWrite(value) {
    const text = String(value || '');
    if (/^https:\/\/labs\.google\/fx\/tools\/flow\/shared\/video\/[0-9a-f-]{36}\/?$/i.test(text)) {
      postToCurrentPage({ source: 'mailab-omni-page', type: 'MAILAB_FLOW_SHARE_LINK', value: text });
    }
    return originalWriteText.call(this, value);
  };
})();
