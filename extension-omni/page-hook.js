(() => {
  if (window.__mailabOmniPageHookInstalled) return;
  window.__mailabOmniPageHookInstalled = true;

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
      const targetOrigin = window.location.origin === 'null' ? '*' : window.location.origin;
      window.postMessage({ source: 'mailab-omni-page', type: 'MAILAB_FLOW_SHARE_LINK', value: text }, targetOrigin);
    }
    return originalWriteText.call(this, value);
  };
})();
