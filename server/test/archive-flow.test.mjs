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
      DOUBAO_LOCAL_RESOLVE: 'false',
      WATERMARK_PROVIDER: 'zhuceka',
      ZHUCEKA_UID: 'test-uid',
      ZHUCEKA_KEY: 'test-key',
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

async function waitForDoubaoWebJob(port, jobId, expectedStatus, timeoutMs = 2500) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const response = await fetch(`http://127.0.0.1:${port}/api/doubao/archive-status`, {
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

async function waitForPlatformJob(port, jobId, platform, expectedStatus, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const response = await fetch(`http://127.0.0.1:${port}/api/order/complete-status`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jobId, platform })
    });
    const body = await response.json();
    if (body.status === expectedStatus) return body;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return undefined;
}

async function waitForClaimJob(port, jobId, expectedStatus, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const response = await fetch(`http://127.0.0.1:${port}/api/order/claim-batch/status`, {
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

test('asynchronous batch claim responds before slow Feishu confirmations and is idempotent', async (t) => {
  const server = await startServer('batch-slow');
  t.after(() => server.stop());

  const payload = { assignee: 'async-tester', count: 5, clientRequestId: 'claim-request-1' };
  const startedAt = Date.now();
  const response = await fetch(`http://127.0.0.1:${server.port}/api/order/claim-batch/start`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload)
  });
  assert.equal(response.status, 202);
  assert.ok(Date.now() - startedAt < 300, 'start endpoint should not wait for Feishu confirmations');
  const started = await response.json();
  assert.equal(started.status, 'processing');
  assert.ok(started.jobId);

  const duplicate = await fetch(`http://127.0.0.1:${server.port}/api/order/claim-batch/start`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload)
  }).then((item) => item.json());
  assert.equal(duplicate.jobId, started.jobId);

  const completed = await waitForClaimJob(server.port, started.jobId, 'completed');
  assert.ok(completed);
  assert.equal(completed.claimed, 5);
  assert.deepEqual(completed.orders.map((order) => order.rowNumber), [1, 2, 3, 4, 5]);
});

test('assignee recovery restores an orphaned batch without browser lock data', async (t) => {
  const server = await startServer('orphaned-batch');
  t.after(() => server.stop());

  const response = await fetch(`http://127.0.0.1:${server.port}/api/order/recover-by-assignee`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ assignee: '也比', limit: 100 })
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.equal(body.orders.length, 5);
  assert.equal(body.orders.every((order) => order.lockId && order.state === 'claimed'), true);
  assert.deepEqual(body.orders.map((order) => order.rowNumber), [1, 2, 3, 4, 5]);
  assert.equal(body.orders.every((order) => order.rowNumberInferred === true), true);
});

test('multi-platform batch endpoint claims unclassified orders with independent locks', async (t) => {
  const server = await startServer('batch');
  t.after(() => server.stop());

  const response = await fetch(`http://127.0.0.1:${server.port}/api/order/claim-batch`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ assignee: 'tester', count: 2 })
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.equal(body.orders.length, 2);
  assert.equal(body.orders.every((order) => order.platform === '' && order.lockId), true);
});

test('multi-platform batch endpoint claims only the requested pending-view row numbers', async (t) => {
  const server = await startServer('batch');
  t.after(() => server.stop());

  const response = await fetch(`http://127.0.0.1:${server.port}/api/order/claim-batch`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ assignee: 'row-tester', count: 2, rowNumbers: [2, 4] })
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.equal(body.requested, 2);
  assert.equal(body.claimed, 2);
  assert.deepEqual(body.orders.map((order) => order.recordId), ['rec2', 'rec4']);
  assert.deepEqual(body.orders.map((order) => order.rowNumber), [2, 4]);
});

test('multi-platform batch endpoint claims 100 orders with unique locks', async (t) => {
  const server = await startServer('batch-100');
  t.after(() => server.stop());

  const response = await fetch(`http://127.0.0.1:${server.port}/api/order/claim-batch`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ assignee: 'bulk-tester', count: 100 })
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.equal(body.requested, 100);
  assert.equal(body.claimed, 100);
  assert.equal(body.partial, false);
  assert.equal(body.orders.length, 100);
  assert.equal(new Set(body.orders.map((order) => order.recordId)).size, 100);
  assert.equal(new Set(body.orders.map((order) => order.lockId)).size, 100);
});

test('Doubao order completes only after unwatermarked video is verified in R2 and written back', async (t) => {
  const server = await startServer('doubao-order-success');
  t.after(() => server.stop());

  const response = await fetch(`http://127.0.0.1:${server.port}/api/order/complete`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      recordId: 'rec1',
      lockId: 'lock1',
      assignee: 'tester',
      shareUrl: 'https://www.doubao.com/thread/xeztYGDAgpoBksrMs',
      fallbackApi: 'https://vas-lf-x.snssdk.com/video/fplay/mock?video_id=test'
    })
  });
  assert.equal(response.status, 200);
  const started = await response.json();
  assert.equal(started.status, 'processing');
  assert.equal(started.platform, '豆包');

  const completed = await waitForPlatformJob(server.port, started.jobId, '豆包', 'completed');
  assert.ok(completed, 'Doubao order job should complete after R2 verification');
  assert.match(completed.videoUrl, /^https:\/\/r2\.test\/mailab\/videos\//);
  const doneUpdate = await waitForUpdate(server.updatesPath, (fields) => fields['任务状态'] === '已完成');
  assert.ok(doneUpdate, 'Feishu order should be marked completed');
  assert.equal(doneUpdate['制作平台'], '豆包');
  assert.match(doneUpdate['视频地址'], /^https:\/\/r2\.test\//);
});

test('Doubao order falls back to the configured provider when the browser cannot extract fallback_api', async (t) => {
  const server = await startServer('doubao-provider-fallback');
  t.after(() => server.stop());

  const response = await fetch(`http://127.0.0.1:${server.port}/api/order/complete`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      recordId: 'rec1',
      lockId: 'lock1',
      assignee: 'tester',
      shareUrl: 'https://www.doubao.com/thread/xVy9XavoQmbpFO6Rw'
    })
  });
  assert.equal(response.status, 200);
  const started = await response.json();
  assert.equal(started.status, 'processing');
  assert.equal(started.platform, '豆包');

  const completed = await waitForPlatformJob(server.port, started.jobId, '豆包', 'completed');
  assert.ok(completed, 'provider fallback should archive and complete the order');
  assert.match(completed.videoUrl, /^https:\/\/r2\.test\/mailab\/videos\//);
});

test('Doubao order fails over when the preferred provider account is disabled', async (t) => {
  const server = await startServer('doubao-provider-disabled-failover');
  t.after(() => server.stop());

  const response = await fetch(`http://127.0.0.1:${server.port}/api/order/complete`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      recordId: 'rec1',
      lockId: 'lock1',
      assignee: 'tester',
      shareUrl: 'https://www.doubao.com/thread/xto8Bs63rRB4J9xfr'
    })
  });
  assert.equal(response.status, 200);
  const started = await response.json();
  const completed = await waitForPlatformJob(server.port, started.jobId, '豆包', 'completed');
  assert.ok(completed, 'a disabled preferred provider should transparently fail over');
  assert.match(completed.videoUrl, /^https:\/\/r2\.test\/mailab\/videos\//);
});

for (const scenario of ['doubao-client-domain-failover', 'doubao-client-decode-failover', 'doubao-client-all-fail']) {
  test(`client fallback_api failures use provider failover: ${scenario}`, async (t) => {
    const server = await startServer(scenario);
    t.after(() => server.stop());
    const response = await fetch(`http://127.0.0.1:${server.port}/api/order/complete`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ recordId: 'rec1', lockId: 'lock1', assignee: 'tester',
        shareUrl: 'https://www.doubao.com/thread/test-thread',
        fallbackApi: 'https://vas-lf-x.snssdk.com/video/fplay/mock' })
    });
    const started = await response.json();
    const fail = scenario === 'doubao-client-all-fail';
    const result = await waitForPlatformJob(server.port, started.jobId, '豆包', fail ? 'failed' : 'completed');
    assert.ok(result, 'client metadata must not bypass the failover chain');
    if (fail) {
      assert.match(result.error, /备用解析暂不可用/);
      assert.equal(readUpdates(server.updatesPath).some((row) => row['任务状态'] || row['接单锁ID'] === ''), false);
    } else {
      assert.match(result.videoUrl, /^https:\/\/r2\.test\//);
    }
  });
}

test('standalone Doubao archive also fails over from an untrusted client video domain', async (t) => {
  const server = await startServer('doubao-client-domain-failover');
  t.after(() => server.stop());
  const response = await fetch(`http://127.0.0.1:${server.port}/api/doubao/archive`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ url: 'https://www.doubao.com/thread/test-thread',
      fallbackApi: 'https://vas-lf-x.snssdk.com/video/fplay/mock' })
  });
  const started = await response.json();
  const result = await waitForDoubaoWebJob(server.port, started.jobId, 'completed');
  assert.ok(result, 'standalone web archive must use the same failover chain');
  assert.match(result.videoUrl, /^https:\/\/r2\.test\//);
});

test('standalone Doubao web archive returns only a verified R2 URL', async (t) => {
  const server = await startServer('doubao-web-success');
  t.after(() => server.stop());

  const response = await fetch(`http://127.0.0.1:${server.port}/api/doubao/archive`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      url: 'https://www.doubao.com/thread/xeztYGDAgpoBksrMs',
      fallbackApi: 'https://vas-lf-x.snssdk.com/video/fplay/mock?video_id=test'
    })
  });
  assert.equal(response.status, 202);
  const started = await response.json();
  assert.equal(started.status, 'processing');

  const completed = await waitForDoubaoWebJob(server.port, started.jobId, 'completed');
  assert.ok(completed, 'Doubao web archive job should complete');
  assert.match(completed.videoUrl, /^https:\/\/r2\.test\/mailab\/videos\//);
  assert.equal(completed.message, '转存完成，R2 直链已验证可访问');
});

test('standalone Doubao web archive rejects non-thread URLs', async (t) => {
  const server = await startServer('doubao-web-success');
  t.after(() => server.stop());

  const response = await fetch(`http://127.0.0.1:${server.port}/api/doubao/archive`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ url: 'https://example.com/not-doubao' })
  });
  assert.equal(response.status, 500);
  const body = await response.json();
  assert.match(body.error, /豆包公开分享链接/);
});

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

test('order stats use Feishu totals instead of scanning the full table', async (t) => {
  const server = await startServer('stats-counts');
  t.after(() => server.stop());

  const response = await fetch(`http://127.0.0.1:${server.port}/api/stats`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}'
  });
  assert.equal(response.status, 200);
  const stats = await response.json();
  assert.deepEqual(stats.counts, {
    pending: 2,
    inProgress: 3,
    done: 4,
    garbage: 1,
    other: 2,
    total: 12
  });
});

test('order stats retry a transient Feishu Data not ready response', async (t) => {
  const server = await startServer('stats-counts-retry');
  t.after(() => server.stop());

  const response = await fetch(`http://127.0.0.1:${server.port}/api/stats`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}'
  });
  assert.equal(response.status, 200);
  const stats = await response.json();
  assert.equal(stats.ok, true);
  assert.equal(stats.counts.total, 12);
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
