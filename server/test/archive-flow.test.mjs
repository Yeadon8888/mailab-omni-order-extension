import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const preloadPath = path.join(projectDir, 'test', 'mock-fetch.mjs');

async function waitForHealth(port) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/health`);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('test server did not become healthy');
}

async function startServer(scenario) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mailab-archive-test-'));
  const updatesPath = path.join(tempDir, 'updates.jsonl');
  const wranglerPath = path.join(tempDir, 'wrangler');
  const port = 19000 + Math.floor(Math.random() * 1000);
  fs.writeFileSync(wranglerPath, '#!/bin/sh\nexit 0\n');
  fs.chmodSync(wranglerPath, 0o755);

  const child = spawn(process.execPath, ['server.js'], {
    cwd: projectDir,
    env: {
      ...process.env,
      NODE_OPTIONS: `--import=${preloadPath}`,
      TEST_SCENARIO: scenario,
      TEST_UPDATES_PATH: updatesPath,
      PORT: String(port),
      FEISHU_APP_ID: 'app-id',
      FEISHU_APP_SECRET: 'app-secret',
      FEISHU_APP_TOKEN: 'base-token',
      FEISHU_TABLE_ID: 'table-id',
      MAILAB_ADMIN_KEY: 'admin-key',
      OSS_ARCHIVE_ENABLED: 'true',
      OSS_ARCHIVE_WRITE_BACK: 'true',
      OSS_ARCHIVE_RETRY_COUNT: '0',
      OSS_ARCHIVE_PUBLIC_VERIFY_ATTEMPTS: '1',
      R2_BUCKET: 'test-bucket',
      R2_PUBLIC_BASE_URL: 'https://r2.test',
      R2_PREFIX: 'mailab/videos',
      CLOUDFLARE_WRANGLER_BIN: wranglerPath
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  await waitForHealth(port);
  return {
    port,
    updatesPath,
    stop() {
      child.kill('SIGTERM');
    }
  };
}

function readUpdates(filePath) {
  if (!fs.existsSync(filePath)) return [];
  return fs.readFileSync(filePath, 'utf8')
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

async function waitForUpdate(filePath, predicate, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const match = readUpdates(filePath).find(predicate);
    if (match) return match;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return undefined;
}

async function waitForJob(port, jobId, expectedStatus, timeoutMs = 2500) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const response = await fetch(`http://127.0.0.1:${port}/api/omni/complete-status`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jobId })
    });
    const body = await response.json();
    if (body.status === expectedStatus) return body;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return undefined;
}

test('complete does not mark the Feishu task done before R2 is readable', async (t) => {
  const server = await startServer('complete');
  t.after(() => server.stop());

  const response = await fetch(`http://127.0.0.1:${server.port}/api/complete`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      recordId: 'rec1',
      lockId: 'lock1',
      assignee: 'tester',
      videoUrl: 'https://source.test/video.mp4',
      directComplete: true
    })
  });
  assert.equal(response.status, 200);
  await new Promise((resolve) => setTimeout(resolve, 150));

  const updates = readUpdates(server.updatesPath);
  assert.ok(updates.length > 0, 'expected at least one Feishu update');
  assert.equal(
    updates.some((fields) => fields['任务状态'] === '已完成'),
    false,
    'a 404 R2 object must never produce 已完成'
  );
});

test('archive retry treats an R2-looking 404 URL as a repair candidate', async (t) => {
  const server = await startServer('retry');
  t.after(() => server.stop());

  const response = await fetch(`http://127.0.0.1:${server.port}/api/archive-retry`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ adminKey: 'admin-key', dryRun: true, limit: 10 })
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.matched, 1);
  assert.equal(body.items[0].recordId, 'rec1');
  assert.equal(body.items[0].videoUrl, 'https://source.test/video.mp4');
});

test('complete marks the task done only after the uploaded R2 URL is readable', async (t) => {
  const server = await startServer('complete-success');
  t.after(() => server.stop());

  const response = await fetch(`http://127.0.0.1:${server.port}/api/complete`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      recordId: 'rec1',
      lockId: 'lock1',
      assignee: 'tester',
      videoUrl: 'https://source.test/video.mp4',
      directComplete: true
    })
  });
  assert.equal(response.status, 200);
  const completed = await waitForUpdate(
    server.updatesPath,
    (fields) => fields['任务状态'] === '已完成'
  );
  assert.ok(completed, 'a readable R2 object should produce 已完成');
  assert.match(JSON.stringify(completed['视频地址']), /https:\/\/r2\.test\//);
});

test('claim records the selected production platform and release clears it', async (t) => {
  const server = await startServer('claim');
  t.after(() => server.stop());

  const claimResponse = await fetch(`http://127.0.0.1:${server.port}/api/claim`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ assignee: 'tester', platform: 'Omni' })
  });
  assert.equal(claimResponse.status, 200);
  const claimed = await claimResponse.json();
  assert.equal(claimed.ok, true);
  assert.equal(claimed.platform, 'Omni');
  assert.ok(claimed.lockId);
  assert.ok(readUpdates(server.updatesPath).some((fields) => fields['制作平台'] === 'Omni'));

  const releaseResponse = await fetch(`http://127.0.0.1:${server.port}/api/release`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ recordId: 'rec1', lockId: claimed.lockId, reason: '测试释放' })
  });
  assert.equal(releaseResponse.status, 200);
  assert.ok(readUpdates(server.updatesPath).some((fields) => fields['制作平台'] === ''));
});

test('Omni batch claim can be recovered and safely released with per-order locks', async (t) => {
  const server = await startServer('batch');
  t.after(() => server.stop());

  const claimResponse = await fetch(`http://127.0.0.1:${server.port}/api/omni/claim-batch`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ assignee: 'batch-tester', count: 3 })
  });
  assert.equal(claimResponse.status, 200);
  const claimed = await claimResponse.json();
  assert.equal(claimed.ok, true);
  assert.equal(claimed.claimed, 3);
  assert.equal(new Set(claimed.orders.map((order) => order.recordId)).size, 3);
  assert.ok(claimed.orders.every((order) => order.platform === 'Omni' && order.lockId));

  const candidates = claimed.orders.map(({ recordId, lockId }) => ({ recordId, lockId }));
  const recoverResponse = await fetch(`http://127.0.0.1:${server.port}/api/omni/recover`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ assignee: 'batch-tester', orders: candidates })
  });
  const recovered = await recoverResponse.json();
  assert.equal(recovered.ok, true);
  assert.equal(recovered.orders.length, 3);
  assert.ok(recovered.orders.every((order) => order.state === 'claimed'));

  const releaseResponse = await fetch(`http://127.0.0.1:${server.port}/api/omni/release-batch`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ assignee: 'batch-tester', orders: candidates })
  });
  const released = await releaseResponse.json();
  assert.equal(released.ok, true);
  assert.equal(released.released, 3);
  assert.equal(released.failed, 0);
});

test('Feishu Data not ready does not block Omni batch claims or order stats', async (t) => {
  const server = await startServer('data-not-ready');
  t.after(() => server.stop());

  const claimResponse = await fetch(`http://127.0.0.1:${server.port}/api/omni/claim-batch`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ assignee: 'fallback-tester', count: 1 })
  });
  assert.equal(claimResponse.status, 200);
  const claimed = await claimResponse.json();
  assert.equal(claimed.ok, true);
  assert.equal(claimed.claimed, 1);
  assert.doesNotMatch(String(claimed.error || ''), /Data not ready/i);

  const statsResponse = await fetch(`http://127.0.0.1:${server.port}/api/stats`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}'
  });
  assert.equal(statsResponse.status, 200);
  const stats = await statsResponse.json();
  assert.equal(stats.ok, true);
  assert.equal(stats.counts.total, 5);
});

test('the same Flow video cannot be bound to two batch orders', async (t) => {
  const server = await startServer('batch');
  t.after(() => server.stop());
  const flowShareUrl = 'https://labs.google/fx/tools/flow/shared/video/67064cd9-aff7-40cb-b501-521ffc7312cc';

  const claimResponse = await fetch(`http://127.0.0.1:${server.port}/api/omni/claim-batch`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ assignee: 'batch-tester', count: 2 })
  });
  const claimed = await claimResponse.json();

  const firstResponse = await fetch(`http://127.0.0.1:${server.port}/api/omni/complete`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      recordId: claimed.orders[0].recordId,
      lockId: claimed.orders[0].lockId,
      assignee: 'batch-tester',
      flowShareUrl
    })
  });
  assert.equal(firstResponse.status, 200);

  const duplicateResponse = await fetch(`http://127.0.0.1:${server.port}/api/omni/complete`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      recordId: claimed.orders[1].recordId,
      lockId: claimed.orders[1].lockId,
      assignee: 'batch-tester',
      flowShareUrl
    })
  });
  assert.equal(duplicateResponse.status, 500);
  const duplicate = await duplicateResponse.json();
  assert.match(duplicate.error, /已经绑定到另一个订单/);
});

test('Omni completes only after Flow video is archived and R2 is readable', async (t) => {
  const server = await startServer('omni-success');
  t.after(() => server.stop());
  const flowShareUrl = 'https://labs.google/fx/tools/flow/shared/video/67064cd9-aff7-40cb-b501-521ffc7312cc';

  const response = await fetch(`http://127.0.0.1:${server.port}/api/omni/complete`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      recordId: 'rec1',
      lockId: 'lock1',
      assignee: 'tester',
      flowShareUrl
    })
  });
  assert.equal(response.status, 200);
  const accepted = await response.json();
  assert.equal(accepted.accepted, true);

  const completedJob = await waitForJob(server.port, accepted.jobId, 'completed');
  assert.ok(completedJob, 'Omni archive job should complete');
  assert.match(completedJob.videoUrl, /^https:\/\/r2\.test\//);
  const updates = readUpdates(server.updatesPath);
  const hyperlinkUpdate = updates.find((fields) => fields['去水印原始链接']);
  assert.deepEqual(hyperlinkUpdate['去水印原始链接'], { text: flowShareUrl, link: flowShareUrl });
  const completed = updates.find((fields) => fields['任务状态'] === '已完成');
  assert.ok(completed, 'readable R2 object should complete the Omni order');
  assert.match(String(completed['视频地址']), /^https:\/\/r2\.test\//);
});

test('Omni archive failure keeps the order in progress for manual retry', async (t) => {
  const server = await startServer('omni-failure');
  t.after(() => server.stop());

  const response = await fetch(`http://127.0.0.1:${server.port}/api/omni/complete`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      recordId: 'rec1',
      lockId: 'lock1',
      assignee: 'tester',
      flowShareUrl: 'https://labs.google/fx/tools/flow/shared/video/67064cd9-aff7-40cb-b501-521ffc7312cc'
    })
  });
  const accepted = await response.json();
  const failedJob = await waitForJob(server.port, accepted.jobId, 'failed');
  assert.ok(failedJob, 'Omni archive job should report failure');
  assert.match(failedJob.message, /保持接单中/);

  const updates = readUpdates(server.updatesPath);
  assert.equal(updates.some((fields) => fields['任务状态'] === '待接单'), false);
  assert.equal(updates.some((fields) => '失败次数' in fields), false);
  assert.ok(updates.some((fields) => String(fields['最后错误'] || '').includes('归档视频失败')));
});
