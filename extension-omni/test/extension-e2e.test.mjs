import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const require = createRequire('/Users/yeadon_1/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/package.json');
const { chromium } = require('playwright');
const here = path.dirname(fileURLToPath(import.meta.url));
const extensionPath = path.resolve(here, '..');
const chromePath = chromium.executablePath();
const projectId = '11111111-1111-4111-8111-111111111111';
const editId = '33333333-3333-4333-8333-333333333333';
const projectUrl = `https://labs.google/fx/tools/flow/project/${projectId}`;
const editUrl = `${projectUrl}/edit/${editId}`;
const shareUrl = 'https://labs.google/fx/tools/flow/shared/video/0125f36a-d85b-4be1-8159-8251333444ad';
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');

let context;
let profileDir;
const browserLogs = [];

test.before(async () => {
  profileDir = await mkdtemp(path.join(tmpdir(), 'mailab-omni-e2e-'));
  context = await chromium.launchPersistentContext(profileDir, {
    executablePath: chromePath,
    headless: true,
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`]
  });
  context.on('page', (page) => {
    page.on('console', (message) => browserLogs.push(`console:${message.type()}:${message.text()}`));
    page.on('pageerror', (error) => browserLogs.push(`pageerror:${error.message}`));
    page.route(`https://labs.google/**/edit/${editId}`, (route) => route.fulfill({ status: 200, contentType: 'text/html', body: shareFixture() })).catch(() => {});
    page.waitForURL(`**/edit/${editId}`, { timeout: 30000 }).then(() => page.reload()).catch(() => {});
  });
  await context.route('https://labs.google/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith(`/edit/${editId}`)) {
      return route.fulfill({ status: 200, contentType: 'text/html', body: shareFixture() });
    }
    return route.fulfill({ status: 200, contentType: 'text/html', body: projectFixture() });
  });
  await context.route('https://genvideo.mailab.top/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/image-proxy') return route.fulfill({ status: 200, contentType: 'image/png', body: png });
    const response = apiResponse(url.pathname);
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(response) });
  });
});

test.after(async () => {
  await context?.close();
  if (profileDir) await rm(profileDir, { recursive: true, force: true });
});

test('extension closes the batch claim → Flow → share → R2/backfill loop', async () => {
  const page = await context.newPage();
  await page.goto(projectUrl);
  const panel = page.locator('#mailab-omni-batch-host');
  await panel.waitFor({ state: 'attached', timeout: 15000 });
  await panel.locator('.panel').waitFor({ timeout: 15000 });
  await panel.locator('#assignee-input').fill('自动化测试员');
  await panel.locator('#count-input').selectOption('1');
  await panel.locator('#claim-button').click();
  await panel.locator('.card[data-state="claimed"]').waitFor({ timeout: 10000 });
  if (process.env.MAILAB_EXTENSION_SCREENSHOT) {
    await page.screenshot({ path: process.env.MAILAB_EXTENSION_SCREENSHOT, fullPage: true });
  }
  await panel.locator('[data-action="feed"]').click();
  try {
    await panel.locator('.card[data-state="completed"]').waitFor({ timeout: 30000 });
  } catch (error) {
    const editPage = context.pages().find((item) => item.url().includes(`/edit/${editId}`));
    const diagnostics = {
      state: await panel.locator('.card').getAttribute('data-state').catch(() => ''),
      message: await panel.locator('.card .message').innerText().catch(() => ''),
      notice: await panel.locator('#notice').innerText().catch(() => ''),
      pages: context.pages().map((item) => item.url()),
      editBody: editPage ? await editPage.locator('body').innerText().catch(() => '') : '',
      dialogHidden: editPage ? await editPage.locator('[role="dialog"]').getAttribute('hidden').catch(() => '') : '',
      hook: editPage ? await editPage.evaluate(() => Boolean(window.__mailabOmniPageHookInstalled)).catch(() => false) : false,
      logs: browserLogs
    };
    throw new Error(`${error.message}\nDiagnostics: ${JSON.stringify(diagnostics)}`);
  }

  const message = await panel.locator('.card .message').innerText();
  const result = await panel.locator('.card .result').getAttribute('href');
  assert.match(message, /飞书已自动回填/);
  assert.equal(result, 'https://r2.example.test/omni/result.mp4');
  await page.close();
});

function apiResponse(pathname) {
  if (pathname === '/api/stats') return { ok: true, counts: { pending: 8, inProgress: 1 } };
  if (pathname === '/api/omni/claim-batch') return {
    ok: true,
    orders: [{
      recordId: 'rec_test_001', lockId: 'lock_test_001', assignee: '自动化测试员',
      prompt: 'A clean product demonstration in a bright studio', imageUrl: 'https://assets.example.test/order.png'
    }]
  };
  if (pathname === '/api/omni/recover') return { ok: true, orders: [], missing: [] };
  if (pathname === '/api/omni/complete') return { ok: true, jobId: 'job_test_001' };
  if (pathname === '/api/omni/complete-status') return { ok: true, status: 'completed', videoUrl: 'https://r2.example.test/omni/result.mp4' };
  return { ok: true };
}

function projectFixture() {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    button,[role=button],[role=option],[contenteditable] { display:block; width:220px; min-height:36px; }
    #grid [role=button] { width:180px; height:180px; }
    [hidden] { display:none !important; }
  </style></head><body>
    <button id="settings" aria-haspopup="menu">Video · 720p · 10s crop_9_16 x1</button>
    <div id="settings-menu" role="menu" hidden><button role="tab">Video</button><button role="tab">Ingredients</button><button>Omni Flash arrow_drop_down</button><button>x1</button></div>
    <input id="file" type="file" accept="image/*" hidden>
    <div id="grid"><div role="button"><a href="${projectUrl}/edit/22222222-2222-4222-8222-222222222222"></a><img alt="Video thumbnail"></div></div>
    <div id="picker" hidden><div id="options"></div><button id="add-prompt">Add to Prompt</button></div>
    <div id="composer">
      <div role="textbox" data-slate-editor="true" contenteditable="true"><p data-slate-node="element"><span data-slate-node="text"><span data-slate-leaf="true"><span data-slate-placeholder="true" contenteditable="false">What do you want to create?</span><span data-slate-zero-width="n" data-slate-length="0">﻿<br></span></span></span></p></div>
      <button id="add">add_2 Create</button><button id="create" aria-disabled="true">arrow_forward Create</button>
    </div>
    <script>
      const settings=document.getElementById('settings'), menu=document.getElementById('settings-menu');
      settings.onpointerdown=()=>{menu.hidden=!menu.hidden};
      let selected=false, attached=false; const editor=document.querySelector('[data-slate-editor]'), create=document.getElementById('create');
      const sync=()=>create.setAttribute('aria-disabled',attached&&!editor.querySelector('[data-slate-placeholder]')?'false':'true');
      document.getElementById('file').onchange=(event)=>{const name=event.target.files[0].name;setTimeout(()=>{const option=document.createElement('div');option.setAttribute('role','option');option.textContent=name+' Image';option.onclick=()=>setTimeout(()=>{selected=true;option.setAttribute('aria-selected','true')},120);document.getElementById('options').append(option)},40)};
      document.getElementById('add').onclick=()=>{document.getElementById('picker').hidden=false};
      document.getElementById('add-prompt').onpointerdown=()=>{if(!selected)return;attached=true;document.getElementById('picker').hidden=true;const cancel=document.createElement('button');cancel.textContent='cancel';document.getElementById('composer').prepend(cancel);sync()};
      editor.addEventListener('beforeinput',(event)=>{if(event.inputType!=='insertText')return;event.preventDefault();editor.innerHTML='<p data-slate-node="element"><span data-slate-node="text"><span data-slate-leaf="true"><span data-slate-string="true"></span></span></span></p>';editor.querySelector('[data-slate-string]').textContent=event.data;sync()});
      create.onclick=()=>{if(create.getAttribute('aria-disabled')==='true')return;const slot=document.createElement('div'),card=document.createElement('div');card.setAttribute('role','button');card.textContent='Generating 1%';slot.append(card);document.getElementById('grid').prepend(slot);setTimeout(()=>{card.textContent='';const link=document.createElement('a');link.href='${editUrl}';card.append(link)},100)};
    </script>
  </body></html>`;
}

function shareFixture() {
  return `<!doctype html><html><body>
    <button id="share">share Share</button>
    <div id="dialog" role="dialog" hidden><button role="switch" aria-checked="true">Include inputs</button><button id="copy">link Copy link</button></div>
    <script>
      document.getElementById('share').onclick=()=>{document.getElementById('dialog').hidden=false};
      document.querySelector('[role=switch]').onclick=(event)=>{const target=event.currentTarget;setTimeout(()=>target.setAttribute('aria-checked','false'),120)};
      document.getElementById('copy').onclick=()=>{
        if(document.querySelector('[role=switch]').getAttribute('aria-checked')==='true')return;
        navigator.clipboard.writeText('${shareUrl}').catch(()=>{});
      };
    </script>
  </body></html>`;
}
