import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const require = createRequire('/Users/yeadon_1/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/package.json');
const { chromium } = require('playwright');
const here = path.dirname(fileURLToPath(import.meta.url));
const adapterPath = path.resolve(here, '..', 'flow-adapter.js');
const hookPath = path.resolve(here, '..', 'page-hook.js');
const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

let browser;

test.before(async () => {
  browser = await chromium.launch({ executablePath: chromePath, headless: true });
});

test.after(async () => {
  await browser?.close();
});

test('opens pointer-driven Flow settings, uploads image, writes prompt and maps the generated edit link', async () => {
  const page = await browser.newPage();
  await page.setContent(`
    <style>
      button,[role=button],[role=option],[contenteditable] { display:block; width:220px; min-height:36px; }
      #grid [role=button] { width:180px; height:180px; }
      [hidden] { display:none !important; }
    </style>
    <button id="settings" aria-haspopup="menu">Video · 720p · 10s crop_9_16 x1</button>
    <div id="settings-menu" role="menu" hidden>
      <button role="tab">Video</button><button role="tab">Ingredients</button>
      <button>Omni Flash arrow_drop_down</button><button>x1</button>
    </div>
    <input id="file" type="file" accept="image/*" hidden>
    <div id="grid"><div role="button"><a href="https://labs.google/fx/tools/flow/project/11111111-1111-4111-8111-111111111111/edit/22222222-2222-4222-8222-222222222222"></a><img alt="Video thumbnail"></div></div>
    <div id="picker" hidden><div id="options"></div><button id="add-prompt">Add to Prompt</button></div>
    <div id="composer">
      <div role="textbox" data-slate-editor="true" contenteditable="true"><p data-slate-node="element"><span data-slate-node="text"><span data-slate-leaf="true"><span data-slate-placeholder="true" contenteditable="false">What do you want to create?</span><span data-slate-zero-width="n" data-slate-length="0">﻿<br></span></span></span></p></div>
      <button id="add">add_2 Create</button>
      <button id="create" aria-disabled="true">arrow_forward Create</button>
    </div>
    <script>
      const settings = document.getElementById('settings');
      const settingsMenu = document.getElementById('settings-menu');
      settings.addEventListener('pointerdown', () => { settingsMenu.hidden = !settingsMenu.hidden; });
      let selected = false;
      let attached = false;
      const editor = document.querySelector('[data-slate-editor]');
      const create = document.getElementById('create');
      function sync() { create.setAttribute('aria-disabled', attached && !editor.querySelector('[data-slate-placeholder]') ? 'false' : 'true'); }
      document.getElementById('file').addEventListener('change', (event) => {
        const name = event.target.files[0].name;
        setTimeout(() => {
          const option = document.createElement('div'); option.setAttribute('role','option'); option.textContent = name + ' Image';
          option.addEventListener('click', () => setTimeout(() => {
            selected = true; option.setAttribute('aria-selected','true');
          }, 120));
          document.getElementById('options').append(option);
        }, 30);
      });
      document.getElementById('add').addEventListener('click', () => { document.getElementById('picker').hidden = false; });
      document.getElementById('add-prompt').addEventListener('pointerdown', () => {
        if (!selected) return; attached = true; document.getElementById('picker').hidden = true;
        const cancel = document.createElement('button'); cancel.textContent = 'cancel'; document.getElementById('composer').prepend(cancel);
        editor.style.display = 'none';
        setTimeout(() => { editor.style.display = 'block'; sync(); }, 250);
      });
      editor.addEventListener('beforeinput', (event) => {
        if (event.inputType !== 'insertText') return; event.preventDefault();
        editor.innerHTML = '<p data-slate-node="element"><span data-slate-node="text"><span data-slate-leaf="true"><span data-slate-string="true"></span></span></span></p>';
        editor.querySelector('[data-slate-string]').textContent = event.data; sync();
      });
      create.addEventListener('click', () => {
        if (create.getAttribute('aria-disabled') === 'true') return;
        const slot = document.createElement('div'); const card = document.createElement('div'); card.setAttribute('role','button'); card.textContent='Generating 1%'; slot.append(card); document.getElementById('grid').prepend(slot);
        setTimeout(() => { card.textContent=''; const link=document.createElement('a'); link.href='https://labs.google/fx/tools/flow/project/11111111-1111-4111-8111-111111111111/edit/33333333-3333-4333-8333-333333333333'; card.append(link); }, 80);
      });
    </script>
  `);
  await page.addScriptTag({ path: hookPath });
  await page.addScriptTag({ path: adapterPath });

  const result = await page.evaluate(async () => {
    const blob = new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' });
    await MailabFlowAdapter.clearComposer();
    const settings = await MailabFlowAdapter.ensureOmniSettings();
    await MailabFlowAdapter.uploadAndAttach(blob, 'mailab-order-1.png');
    await MailabFlowAdapter.setSlatePrompt('A product rotates on a clean studio table');
    const tracker = MailabFlowAdapter.startGeneration();
    const submitted = await tracker.submitted;
    return { settings, submitted, editUrl: await tracker.result };
  });

  assert.match(result.settings, /^Video/);
  assert.equal(result.submitted, true);
  assert.equal(result.editUrl, 'https://labs.google/fx/tools/flow/project/11111111-1111-4111-8111-111111111111/edit/33333333-3333-4333-8333-333333333333');
  await page.close();
});

test('captures only Flow share links written by the page', async () => {
  const page = await browser.newPage();
  await page.setContent('<main>share fixture</main>');
  await page.evaluate(() => {
    class ClipboardProbe { async writeText(value) { window.__lastClipboardValue = value; } }
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: new ClipboardProbe() });
    window.__captured = [];
    window.addEventListener('message', (event) => {
      if (event.data?.type === 'MAILAB_FLOW_SHARE_LINK') window.__captured.push(event.data.value);
    });
  });
  await page.addScriptTag({ path: hookPath });
  await page.evaluate(async () => {
    await navigator.clipboard.writeText('ordinary text');
    await navigator.clipboard.writeText('https://labs.google/fx/tools/flow/shared/video/0125f36a-d85b-4be1-8159-8251333444ad');
  });
  await page.waitForTimeout(50);
  const captured = await page.evaluate(() => window.__captured);
  assert.deepEqual(captured, ['https://labs.google/fx/tools/flow/shared/video/0125f36a-d85b-4be1-8159-8251333444ad']);
  await page.close();
});
