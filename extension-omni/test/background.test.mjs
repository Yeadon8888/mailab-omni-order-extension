import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import vm from 'node:vm';

const here = path.dirname(fileURLToPath(import.meta.url));
const backgroundSource = await readFile(path.resolve(here, '..', 'background.js'), 'utf8');

test('opens the Flow share worker in the foreground and remembers the source tab', async () => {
  let messageListener;
  let createdOptions;
  const tabMessages = [];
  const storage = {};
  const chrome = {
    runtime: {
      onMessage: { addListener(listener) { messageListener = listener; } }
    },
    action: { onClicked: { addListener() {} } },
    storage: {
      local: {
        async get(defaults) { return { ...defaults, ...storage }; },
        async set(values) { Object.assign(storage, values); }
      }
    },
    tabs: {
      async create(options) { createdOptions = options; return { id: 42 }; },
      async remove() {},
      async update() {},
      async sendMessage(tabId, message) { tabMessages.push({ tabId, message }); }
    }
  };
  vm.runInNewContext(backgroundSource, { chrome, URL, fetch, setTimeout, clearTimeout, console });

  const response = await new Promise((resolve) => {
    const keepChannelOpen = messageListener({
      type: 'MAILAB_OPEN_SHARE_WORK',
      work: {
        editUrl: 'https://labs.google/fx/tools/flow/project/11111111-1111-4111-8111-111111111111/edit/22222222-2222-4222-8222-222222222222',
        recordId: 'rec_test',
        lockId: 'lock_test',
        assignee: 'tester',
        serverUrl: 'https://genvideo.mailab.top'
      }
    }, { tab: { id: 7 } }, resolve);
    assert.equal(keepChannelOpen, true);
  });

  assert.equal(response.ok, true);
  assert.equal(createdOptions.active, true);
  assert.equal(createdOptions.openerTabId, 7);
  assert.equal(tabMessages.length, 1);
  assert.equal(tabMessages[0].tabId, 42);
  assert.equal(tabMessages[0].message.type, 'MAILAB_RUN_SHARE_WORKER');
});
