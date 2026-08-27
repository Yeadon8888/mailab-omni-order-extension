import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import vm from 'node:vm';

const here = path.dirname(fileURLToPath(import.meta.url));
const backgroundSource = await readFile(path.resolve(here, '..', 'background.js'), 'utf8');

function eventStub() {
  return { addListener() {} };
}

function loadBackground(fetchImpl = fetch) {
  const runtimeMessageListeners = [];
  const chrome = {
    runtime: {
      onMessage: { addListener(listener) { runtimeMessageListeners.push(listener); } },
      onInstalled: eventStub(),
      onStartup: eventStub(),
      getURL(relativePath) { return `chrome-extension://test/${relativePath}`; }
    },
    tabs: {
      onActivated: eventStub(),
      onUpdated: eventStub(),
      onRemoved: eventStub(),
      async query() { return []; },
      async get() { return null; }
    },
    action: {
      onClicked: eventStub(),
      async setBadgeText() {},
      async setBadgeBackgroundColor() {}
    },
    debugger: {
      onDetach: eventStub(),
      onEvent: eventStub()
    },
    downloads: {
      async download() {}
    }
  };
  const context = {
    chrome,
    URL,
    fetch: fetchImpl,
    crypto,
    TextDecoder,
    Uint8Array,
    atob,
    btoa,
    setTimeout,
    clearTimeout,
    console
  };
  vm.runInNewContext(backgroundSource, context);
  context.runtimeMessageListeners = runtimeMessageListeners;
  return context;
}

test('decodes the qAAB video URL format used by Doubao fallback_api', async () => {
  const context = loadBackground();
  const token = 'qAABAH8hYpJzWAiQddxcgovhJDuNl8dxJ3SKuRciwj/6TJiFggqmF6Glb1nvilgOUxqPGBL/jF+Btiz8FKS+1SOGUUw=';
  const keySeed = 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=';

  const result = await context.decodeMainUrl(token, keySeed);

  assert.equal(result, 'https://cdn.example.test/video/no-watermark.mp4?source=doubao');
});

test('resolves a public Doubao thread to an unwatermarked direct video URL', async () => {
  const keySeed = 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=';
  const token = 'qAABAJsxUq3vNy+yC7j4VcQB1n+6pAYAK6S9lerQqtozCi4MDEjhD7ounKZDobpDvCA0y7/RlgvgvupEZEDvbsaDYNSZjXI1FVx4hcVg9wBxIZEL/RDAhaHgcbI4cF3RqEKzeg==';
  const requested = [];
  const fetchImpl = async (input) => {
    const url = new URL(String(input));
    requested.push(url);
    if (url.hostname === 'www.doubao.com') {
      return new Response(`fallback_api\\&quot;:\\&quot;https:\\u002F\\u002Fvas-lf-x.snssdk.com\\u002Fvideo\\u002Ffplay\\u002F1\\u002Fhash\\u002Fvideo?aid=1938&amp;key_seed=${encodeURIComponent(keySeed)}\\&quot;`);
    }
    return Response.json({
      video_info: {
        data: {
          key_seed: keySeed,
          video_list: { video_1: { bitrate: 3368682, vwidth: 720, vheight: 1280, main_url: token } }
        }
      }
    });
  };
  const context = loadBackground(fetchImpl);

  const response = await new Promise((resolve) => {
    const handled = context.runtimeMessageListeners.some((listener) => (
      listener({ type: 'DOUBAO_RESOLVE_THREAD', url: 'https://www.doubao.com/thread/test-thread' }, {}, resolve) === true
    ));
    assert.equal(handled, true);
  });

  assert.equal(response.ok, true);
  assert.equal(response.data.videoUrl, 'https://v3-default.douyin.com/video/test.mp4?lr=unwatermarked&mime_type=video_mp4');
  assert.equal(requested.length, 2);
  assert.equal(requested[1].searchParams.get('channel'), 'no');
  assert.equal(requested[1].searchParams.get('codec_type'), '8');
  assert.equal(requested[1].searchParams.get('logo_type'), 'unwatermarked');
});
