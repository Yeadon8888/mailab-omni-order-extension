import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { URL } from 'node:url';
import { normalizeDoubaoThreadUrl, resolveDoubaoThreadVideo } from './doubao-thread-resolver.mjs';

const execFileAsync = promisify(execFile);
const env = loadEnv();
const CLAIM_PLATFORMS = new Set(['豆包', 'Omni']);
const FLOW_HOST = 'labs.google';
const FLOW_SHARE_PATH = /^\/fx\/tools\/flow\/shared\/video\/([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\/?$/i;
const MAX_OMNI_BATCH_ORDERS = 10;
const OMNI_FLOW_RESERVATION_TTL_MS = 24 * 60 * 60 * 1000;
const ORDER_STATS_CACHE_TTL_MS = 30 * 1000;
const archiveRetryCount = Math.max(0, Number.parseInt(
  env.OSS_ARCHIVE_RETRY_COUNT || (env.OSS_ARCHIVE_MAX_ATTEMPTS ? String((Number.parseInt(env.OSS_ARCHIVE_MAX_ATTEMPTS, 10) || 1) - 1) : '3'),
  10
) || 0);
const config = {
  port: Number(env.PORT || 8787),
  allowedOrigins: String(env.ALLOWED_ORIGINS || '*').split(',').map((item) => item.trim()).filter(Boolean),
  feishuAppId: env.FEISHU_APP_ID || '',
  feishuAppSecret: env.FEISHU_APP_SECRET || '',
  appToken: env.FEISHU_APP_TOKEN || extractBaseToken(env.FEISHU_BASE_URL || ''),
  tableId: env.FEISHU_TABLE_ID || extractQuery(env.FEISHU_BASE_URL || '', 'table'),
  pendingViewId: env.FEISHU_PENDING_VIEW_ID || '',
  pendingViewName: env.FEISHU_PENDING_VIEW_NAME || '待接单',
  watermarkProvider: env.WATERMARK_PROVIDER || 'doubao',
  doubaoApiOrigin: env.DOUBAO_API_ORIGIN || 'https://api.sdtmp.com/tools/doubao',
  doubaoAuthToken: env.DOUBAO_AUTH_TOKEN || '',
  doubaoLocalResolve: String(env.DOUBAO_LOCAL_RESOLVE || 'true').toLowerCase() !== 'false',
  zhucekaApiUrl: env.ZHUCEKA_API_URL || 'https://api.zhuceka.cn/home/api',
  zhucekaUid: env.ZHUCEKA_UID || '',
  zhucekaKey: env.ZHUCEKA_KEY || '',
  qsyBaseUrl: env.QSY_BASE_URL || 'https://qsy.lmengcity.com/mp-6',
  qsyOpenid: env.QSY_OPENID || '',
  qsyUserAgent: env.QSY_USER_AGENT || '',
  qsyReferer: env.QSY_REFERER || 'https://servicewechat.com/wx760a946be06f096c/9/page-frame.html',
  testVideoUrl: env.MAILAB_TEST_VIDEO_URL || 'https://example.com/mailab-test-video.mp4',
  writeWatermarkUrl: String(env.WRITE_WATERMARK_URL || 'false').toLowerCase() === 'true',
  licenseKeys: parseLicenseKeys(env.MAILAB_LICENSE_KEYS || ''),
  adminKey: env.MAILAB_ADMIN_KEY || '',
  archive: {
    enabled: String(env.OSS_ARCHIVE_ENABLED || env.OSS_ENABLED || 'false').toLowerCase() === 'true',
    provider: env.OSS_PROVIDER || 'wrangler-r2',
    bucket: env.R2_BUCKET || env.OSS_BUCKET || '',
    publicBaseUrl: env.R2_PUBLIC_BASE_URL || env.OSS_PUBLIC_BASE_URL || '',
    prefix: env.R2_PREFIX || env.OSS_PREFIX || 'mailab/videos',
    wranglerBin: env.CLOUDFLARE_WRANGLER_BIN || 'wrangler',
    wranglerCwd: env.CLOUDFLARE_WRANGLER_CWD || '',
    cloudflareApiToken: env.CLOUDFLARE_API_TOKEN || '',
    cloudflareAccountId: env.CLOUDFLARE_ACCOUNT_ID || '',
    jurisdiction: env.R2_JURISDICTION || '',
    maxBytes: Number(env.OSS_MAX_VIDEO_BYTES || 500 * 1024 * 1024),
    downloadTimeoutMs: Number(env.OSS_DOWNLOAD_TIMEOUT_MS || 180000),
    uploadTimeoutMs: Number(env.OSS_UPLOAD_TIMEOUT_MS || 180000),
    concurrency: Math.max(1, Number.parseInt(env.OSS_ARCHIVE_CONCURRENCY || '1', 10) || 1),
    retryCount: archiveRetryCount,
    maxAttempts: archiveRetryCount + 1,
    retryDelayMs: Math.max(1000, Number.parseInt(env.OSS_ARCHIVE_RETRY_DELAY_MS || '5000', 10) || 5000),
    publicVerifyAttempts: Math.max(1, Number.parseInt(env.OSS_ARCHIVE_PUBLIC_VERIFY_ATTEMPTS || '8', 10) || 8),
    publicVerifyDelayMs: Math.max(1000, Number.parseInt(env.OSS_ARCHIVE_PUBLIC_VERIFY_DELAY_MS || '5000', 10) || 5000),
    maxPreparedFiles: Math.max(1, Number.parseInt(env.OSS_ARCHIVE_MAX_PREPARED_FILES || '20', 10) || 20),
    writeBack: String(env.OSS_ARCHIVE_WRITE_BACK || 'false').toLowerCase() === 'true'
  },
  fields: {
    prompt: env.FIELD_PROMPT || '提示词',
    imageUrl: env.FIELD_IMAGE_URL || '图片地址',
    status: env.FIELD_STATUS || '任务状态',
    assignee: env.FIELD_ASSIGNEE || '接单人',
    claimedAt: env.FIELD_CLAIMED_AT || '接单时间',
    completedAt: env.FIELD_COMPLETED_AT || '完成时间',
    videoUrl: env.FIELD_VIDEO_URL || '视频地址',
    failCount: env.FIELD_FAIL_COUNT || '失败次数',
    log: env.FIELD_LOG || '接单日志',
    lockId: env.FIELD_LOCK_ID || '接单锁ID',
    watermarkUrl: env.FIELD_WATERMARK_URL || '去水印原始链接',
    lastError: env.FIELD_LAST_ERROR || '最后错误',
    platform: env.FIELD_PLATFORM || '制作平台'
  },
  statuses: {
    pending: env.STATUS_PENDING || '待接单',
    inProgress: env.STATUS_IN_PROGRESS || '接单中',
    done: env.STATUS_DONE || '已完成',
    garbage: env.STATUS_GARBAGE || '垃圾任务'
  },
  maxFailCount: Number(env.MAX_FAIL_COUNT || 3)
};

let tokenCache = { token: '', expiresAt: 0 };
let orderStatsCache = { value: null, expiresAt: 0, refreshPromise: null };
class AsyncMutex {
  constructor() {
    this.current = Promise.resolve();
  }

  runExclusive(fn) {
    const next = this.current.then(fn, fn);
    this.current = next.catch(() => undefined);
    return next;
  }
}

const claimMutex = new AsyncMutex();
const doubaoPolling = new Map();
const completeJobs = new Map();
const omniFlowReservations = new Map();
const archiveQueue = [];
const archiveQueuedKeys = new Set();
let archiveRunning = 0;
let archivePreparedSlots = 0;

const server = http.createServer(async (req, res) => {
  try {
    if (handleCors(req, res)) {
      return;
    }

    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    if (req.method === 'GET' && url.pathname === '/api/health') {
      sendJson(res, 200, {
        ok: true,
        appToken: mask(config.appToken),
        tableId: config.tableId || '',
        feishuConfigured: Boolean(config.feishuAppId && config.feishuAppSecret && config.appToken && config.tableId),
        archiveEnabled: config.archive.enabled,
        archiveConfigured: !config.archive.enabled || isArchiveConfigured(),
        features: ['platform-claim', 'omni-complete', 'omni-batch']
      });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/image-proxy') {
      await handleImageProxy(req, res, url);
      return;
    }

    if (req.method !== 'POST') {
      sendJson(res, 404, { ok: false, error: 'Not found' });
      return;
    }

    const body = await readJson(req);
    if (url.pathname === '/api/license/verify') {
      const result = verifyLicense(body);
      sendJson(res, 200, result);
      return;
    }
    if (url.pathname === '/api/claim') {
      const result = await claimMutex.runExclusive(() => claimOrder(body));
      sendJson(res, 200, result);
      return;
    }
    if (url.pathname === '/api/omni/claim-batch') {
      const result = await claimMutex.runExclusive(() => claimOmniBatch(body));
      sendJson(res, 200, result);
      return;
    }
    if (url.pathname === '/api/stats') {
      const result = await getOrderStats();
      sendJson(res, 200, result);
      return;
    }
    if (url.pathname === '/api/archive-retry') {
      const result = await retryUnarchivedVideos(body);
      sendJson(res, 200, result);
      return;
    }
    if (url.pathname === '/api/complete') {
      const result = await startCompleteOrder(body);
      sendJson(res, 200, result);
      return;
    }
    if (url.pathname === '/api/complete-status') {
      const result = getCompleteJobStatus(body);
      sendJson(res, 200, result);
      return;
    }
    if (url.pathname === '/api/omni/complete') {
      const result = await startOmniComplete(body);
      sendJson(res, 200, result);
      return;
    }
    if (url.pathname === '/api/omni/complete-status') {
      const result = getCompleteJobStatus(body, 'omni');
      sendJson(res, 200, result);
      return;
    }
    if (url.pathname === '/api/omni/recover') {
      const result = await recoverOmniOrders(body);
      sendJson(res, 200, result);
      return;
    }
    if (url.pathname === '/api/omni/release-batch') {
      const result = await releaseOmniBatch(body);
      sendJson(res, 200, result);
      return;
    }
    if (url.pathname === '/api/release') {
      const result = await releaseOrder(body);
      sendJson(res, 200, result);
      return;
    }

    sendJson(res, 404, { ok: false, error: 'Not found' });
  } catch (error) {
    console.error(error);
    sendJson(res, 500, { ok: false, error: publicError(error), videoUrl: error?.videoUrl || '' });
  }
});

server.listen(config.port, () => {
  console.log(`MAILAB order server listening on http://127.0.0.1:${config.port}`);
});

function verifyLicense(body) {
  const key = String(body?.key || '').trim();
  if (!key) {
    return { ok: false, error: '请输入授权密钥' };
  }
  const license = config.licenseKeys.get(key);
  if (!license) {
    return { ok: false, error: '授权密钥无效' };
  }
  if (!license.active) {
    return { ok: false, error: '授权密钥已停用' };
  }
  if (license.expiresAt && isExpiredDate(license.expiresAt)) {
    return { ok: false, error: '授权密钥已过期' };
  }
  return {
    ok: true,
    name: license.name,
    expiresAt: license.expiresAt,
    verifiedAt: Date.now()
  };
}

async function claimOrder(body) {
  requireFeishuConfig();
  const assignee = String(body?.assignee || '').trim();
  const platform = normalizeClaimPlatform(body?.platform);
  if (!assignee) {
    throw new Error('请输入接单人');
  }

  const pending = await findPendingRecord();
  if (!pending) {
    return { ok: false, error: '暂无待接单任务' };
  }

  return claimPendingRecord(pending, assignee, platform);
}

async function claimPendingRecord(pending, assignee, platform) {
  const lockId = crypto.randomUUID();
  const now = nowText();
  const previousLog = fieldText(pending.fields[config.fields.log]);
  const fields = {
    [config.fields.status]: config.statuses.inProgress,
    [config.fields.assignee]: assignee,
    [config.fields.claimedAt]: Date.now(),
    [config.fields.lockId]: lockId,
    ...(platform ? { [config.fields.platform]: platform } : {}),
    [config.fields.log]: appendLog(previousLog, `${assignee} 于 ${now}${platform ? ` 使用 ${platform} 插件` : ''}接单`)
  };
  await updateRecord(pending.record_id, fields);

  const confirmed = await getRecord(pending.record_id);
  if (fieldText(confirmed.fields[config.fields.lockId]) !== lockId) {
    throw new Error('接单锁确认失败，请重试');
  }

  return {
    ok: true,
    recordId: pending.record_id,
    lockId,
    assignee,
    prompt: fieldText(confirmed.fields[config.fields.prompt]),
    imageUrl: fieldText(confirmed.fields[config.fields.imageUrl]),
    platform: fieldText(confirmed.fields[config.fields.platform]) || platform,
    status: fieldText(confirmed.fields[config.fields.status]),
    claimedAt: fieldText(confirmed.fields[config.fields.claimedAt])
  };
}

async function claimOmniBatch(body) {
  requireFeishuConfig();
  const assignee = String(body?.assignee || '').trim();
  const count = Number.parseInt(body?.count, 10);
  if (!assignee) {
    throw new Error('请输入接单人');
  }
  if (!Number.isInteger(count) || count < 1 || count > MAX_OMNI_BATCH_ORDERS) {
    throw new Error(`批量接单数量必须是 1–${MAX_OMNI_BATCH_ORDERS}`);
  }

  const orders = [];
  let error = '';
  let pendingRecords = [];
  try {
    pendingRecords = (await listPendingRecords())
      .filter((record) => fieldText(record.fields?.[config.fields.status]) === config.statuses.pending)
      .slice(0, count);
  } catch (listError) {
    return {
      ok: false,
      requested: count,
      claimed: 0,
      partial: true,
      orders: [],
      error: publicError(listError)
    };
  }

  for (const pending of pendingRecords) {
    try {
      const order = await claimPendingRecord(pending, assignee, 'Omni');
      orders.push(order);
    } catch (claimError) {
      error = publicError(claimError);
      break;
    }
  }
  if (orders.length < count && !error) {
    error = pendingRecords.length < count ? '当前待接单任务数量不足' : '部分任务未能完成加锁';
  }

  return {
    ok: orders.length > 0,
    requested: count,
    claimed: orders.length,
    partial: orders.length < count,
    orders,
    error: orders.length ? error : (error || '暂无待接单任务')
  };
}

async function recoverOmniOrders(body) {
  requireFeishuConfig();
  const assignee = String(body?.assignee || '').trim();
  const candidates = normalizeLockCandidates(body?.orders);
  if (!assignee) {
    throw new Error('请输入接单人');
  }
  if (!candidates.length) {
    return { ok: true, orders: [], missing: [] };
  }

  const orders = [];
  const missing = [];
  for (const candidate of candidates) {
    try {
      const record = await getRecord(candidate.recordId);
      const fields = record.fields || {};
      const ownsLock = fieldText(fields[config.fields.lockId]) === candidate.lockId
        && fieldText(fields[config.fields.assignee]) === assignee
        && fieldText(fields[config.fields.platform]) === 'Omni';
      const status = fieldText(fields[config.fields.status]);
      if (!ownsLock || ![config.statuses.inProgress, config.statuses.done].includes(status)) {
        missing.push({ recordId: candidate.recordId, reason: '订单已释放、锁已变化或不属于当前接单人' });
        continue;
      }
      const job = findRunningCompleteJob(candidate.recordId, candidate.lockId);
      orders.push({
        ok: true,
        recordId: candidate.recordId,
        lockId: candidate.lockId,
        assignee,
        platform: 'Omni',
        prompt: fieldText(fields[config.fields.prompt]),
        imageUrl: fieldText(fields[config.fields.imageUrl]),
        flowShareUrl: fieldText(fields[config.fields.watermarkUrl]),
        videoUrl: fieldText(fields[config.fields.videoUrl]),
        status,
        state: status === config.statuses.done ? 'completed' : (job ? 'processing' : 'claimed'),
        jobId: job?.jobId || '',
        message: status === config.statuses.done ? '已完成' : (job?.message || '已恢复接单状态')
      });
    } catch (error) {
      missing.push({ recordId: candidate.recordId, reason: publicError(error) });
    }
  }
  return { ok: true, orders, missing };
}

async function releaseOmniBatch(body) {
  requireFeishuConfig();
  const assignee = String(body?.assignee || '').trim();
  const candidates = normalizeLockCandidates(body?.orders);
  if (!assignee) {
    throw new Error('请输入接单人');
  }
  if (!candidates.length) {
    throw new Error('没有可释放的 Omni 订单');
  }

  const results = [];
  for (const candidate of candidates) {
    try {
      await releaseOrder({
        recordId: candidate.recordId,
        lockId: candidate.lockId,
        assignee,
        platform: 'Omni',
        reason: '用户在 Omni 批量工作台释放任务'
      });
      results.push({ recordId: candidate.recordId, ok: true });
    } catch (error) {
      results.push({ recordId: candidate.recordId, ok: false, error: publicError(error) });
    }
  }
  return {
    ok: results.some((item) => item.ok),
    released: results.filter((item) => item.ok).length,
    failed: results.filter((item) => !item.ok).length,
    results
  };
}

function normalizeLockCandidates(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  const candidates = [];
  const seen = new Set();
  for (const item of value.slice(0, MAX_OMNI_BATCH_ORDERS)) {
    const recordId = String(item?.recordId || '').trim();
    const lockId = String(item?.lockId || '').trim();
    if (!recordId || !lockId || seen.has(recordId)) {
      continue;
    }
    seen.add(recordId);
    candidates.push({ recordId, lockId });
  }
  return candidates;
}

async function startCompleteOrder(body) {
  requireFeishuConfig();
  const recordId = String(body?.recordId || '').trim();
  const lockId = String(body?.lockId || '').trim();
  const assignee = String(body?.assignee || '').trim();
  const directVideoUrl = normalizeHttpUrl(body?.videoUrl || '');
  if (body?.directComplete || directVideoUrl) {
    return completeOrderWithVideoUrl({ recordId, lockId, assignee, videoUrl: directVideoUrl });
  }
  const watermarkUrl = String(body?.watermarkUrl || '').trim();
  const testMode = Boolean(body?.testMode);
  const normalizedWatermarkUrl = normalizeDoubaoUrl(watermarkUrl);
  const writableWatermarkUrl = normalizedWatermarkUrl || ((testMode || ['qsy', 'zhuceka'].includes(config.watermarkProvider)) ? normalizeHttpUrl(watermarkUrl) : '');
  if (!recordId || !lockId || !assignee || !watermarkUrl) {
    throw new Error('缺少 recordId、lockId、接单人或去水印链接');
  }
  if (!writableWatermarkUrl) {
    throw new Error('未识别到豆包分享链接');
  }

  const record = await getRecord(recordId);
  assertLock(record, lockId, assignee);

  const existingJob = findRunningCompleteJob(recordId, lockId);
  if (existingJob) {
    return {
      ok: true,
      accepted: true,
      jobId: existingJob.jobId,
      status: existingJob.status,
      message: '该任务正在后台处理中'
    };
  }

  const jobId = crypto.randomUUID();
  const job = {
    jobId,
    recordId,
    lockId,
    assignee,
    status: 'processing',
    message: '后台处理中',
    videoUrl: '',
    error: '',
    createdAt: Date.now(),
    updatedAt: Date.now()
  };
  completeJobs.set(jobId, job);
  runCompleteOrderJob(job, record, {
    writableWatermarkUrl,
    normalizedWatermarkUrl,
    testMode
  });
  return { ok: true, accepted: true, jobId, status: job.status, message: job.message };
}

async function startOmniComplete(body) {
  requireFeishuConfig();
  if (!config.archive.enabled || !config.archive.writeBack || !isArchiveConfigured()) {
    throw new Error('Omni 完成接口需要启用并配置 R2 归档与回填');
  }

  const recordId = String(body?.recordId || '').trim();
  const lockId = String(body?.lockId || '').trim();
  const assignee = String(body?.assignee || '').trim();
  const flowShareUrl = normalizeFlowShareUrl(body?.flowShareUrl || body?.videoUrl || '');
  if (!recordId || !lockId || !assignee || !flowShareUrl) {
    throw new Error('缺少 recordId、lockId、接单人或有效的 Flow 视频分享链接');
  }

  const record = await getRecord(recordId);
  assertLock(record, lockId, assignee);
  const platform = fieldText(record.fields?.[config.fields.platform]);
  if (platform && platform !== 'Omni') {
    throw new Error(`当前任务由 ${platform} 插件领取，不能使用 Omni 完成`);
  }

  const existingJob = findRunningCompleteJob(recordId, lockId);
  if (existingJob) {
    if (existingJob.flowShareUrl !== flowShareUrl) {
      throw new Error('当前订单正在转存另一个 Flow 视频，请等待完成后再操作');
    }
    return {
      ok: true,
      accepted: true,
      jobId: existingJob.jobId,
      status: existingJob.status,
      message: existingJob.message
    };
  }

  const reservation = reserveOmniFlow(flowShareUrl, recordId, lockId);
  const jobId = crypto.randomUUID();
  const sourceVideoUrl = flowVideoSourceUrl(flowShareUrl);
  const job = {
    jobId,
    type: 'omni',
    recordId,
    lockId,
    assignee,
    status: 'processing',
    message: '正在获取 Flow 视频并转存到 R2',
    error: '',
    videoUrl: '',
    flowShareUrl,
    createdAt: Date.now(),
    updatedAt: Date.now()
  };
  completeJobs.set(jobId, job);

  try {
    await updateRecord(recordId, {
      [config.fields.watermarkUrl]: hyperlinkField(flowShareUrl),
      [config.fields.platform]: 'Omni',
      [config.fields.lastError]: '',
      [config.fields.log]: appendLog(
        fieldText(record.fields?.[config.fields.log]),
        `${assignee} 于 ${nowText()} 提交 Omni 视频转存：${flowShareUrl}`
      )
    });
    const queued = queueVideoArchive({
      recordId,
      lockId,
      assignee,
      videoUrl: sourceVideoUrl,
      source: 'omni',
      flowShareUrl,
      completeJobId: jobId
    });
    if (!queued) {
      throw new Error('该 Omni 视频已经在转存队列中');
    }
  } catch (error) {
    completeJobs.delete(jobId);
    if (reservation.created) {
      releaseOmniFlowReservations(recordId, lockId);
    }
    throw error;
  }

  return {
    ok: true,
    accepted: true,
    jobId,
    status: job.status,
    message: job.message
  };
}

async function completeOrderWithVideoUrl({ recordId, lockId, assignee, videoUrl }) {
  if (!recordId || !lockId || !assignee || !videoUrl) {
    throw new Error('缺少 recordId、lockId、接单人或视频链接');
  }

  const record = await getRecord(recordId);
  assertLock(record, lockId, assignee);

  try {
    const now = nowText();
    const waitsForArchive = config.archive.enabled;
    await updateRecord(recordId, {
      [config.fields.videoUrl]: textUrlField(videoUrl),
      [config.fields.status]: waitsForArchive ? config.statuses.inProgress : config.statuses.done,
      ...(waitsForArchive ? {} : { [config.fields.completedAt]: Date.now() }),
      [config.fields.lastError]: '',
      [config.fields.log]: appendLog(
        fieldText(record.fields[config.fields.log]),
        waitsForArchive
          ? `${assignee} 于 ${now} 已取得视频，等待 R2 归档验证；源地址：${videoUrl}`
          : `${assignee} 于 ${now} 直接同步视频地址：${videoUrl}`
      )
    });
    if (waitsForArchive) {
      queueVideoArchive({
        recordId,
        assignee,
        videoUrl,
        source: 'direct'
      });
    }
    return { ok: true, directComplete: true, archiving: waitsForArchive, videoUrl, completedAt: waitsForArchive ? '' : now };
  } catch (error) {
    await rollbackOrder(record, assignee, error);
    error.videoUrl = videoUrl;
    throw error;
  }
}

async function runCompleteOrderJob(job, record, options) {
  const { writableWatermarkUrl, normalizedWatermarkUrl, testMode } = options;
  let videoUrl = '';
  try {
    if (config.writeWatermarkUrl) {
      await updateRecord(job.recordId, { [config.fields.watermarkUrl]: hyperlinkField(writableWatermarkUrl) });
    }
    videoUrl = testMode ? config.testVideoUrl : await runWatermarkRemoval(writableWatermarkUrl);
    if (!videoUrl) {
      throw new Error('去水印接口暂未返回视频地址');
    }
    const now = nowText();
    const waitsForArchive = config.archive.enabled;
    await updateRecord(job.recordId, {
      [config.fields.videoUrl]: textUrlField(videoUrl),
      [config.fields.status]: waitsForArchive ? config.statuses.inProgress : config.statuses.done,
      ...(waitsForArchive ? {} : { [config.fields.completedAt]: Date.now() }),
      [config.fields.lastError]: '',
      [config.fields.log]: appendLog(
        fieldText(record.fields[config.fields.log]),
        waitsForArchive
          ? `${job.assignee} 于 ${now} 已取得视频，等待 R2 归档验证；源地址：${videoUrl}`
          : `${job.assignee} 于 ${now} 完成，视频地址：${videoUrl}`
      )
    });
    if (waitsForArchive) {
      queueVideoArchive({
        recordId: job.recordId,
        assignee: job.assignee,
        videoUrl,
        source: 'watermark'
      });
    }
    Object.assign(job, {
      status: 'completed',
      message: waitsForArchive ? '视频已取得，正在后台归档到 R2' : '已完成并同步飞书',
      archiving: waitsForArchive,
      videoUrl,
      completedAt: waitsForArchive ? '' : now,
      updatedAt: Date.now()
    });
  } catch (error) {
    try {
      await rollbackOrder(record, job.assignee, error);
    } catch (rollbackError) {
      console.error('rollback failed', rollbackError);
    }
    Object.assign(job, {
      status: 'failed',
      message: '处理失败，任务已回滚',
      error: publicError(error),
      videoUrl,
      updatedAt: Date.now()
    });
  } finally {
    setTimeout(() => {
      completeJobs.delete(job.jobId);
    }, 30 * 60 * 1000);
  }
}

function getCompleteJobStatus(body, expectedType = '') {
  const jobId = String(body?.jobId || '').trim();
  if (!jobId) {
    throw new Error('缺少 jobId');
  }
  const job = completeJobs.get(jobId);
  if (!job) {
    return { ok: false, status: 'missing', error: '后台任务不存在或已过期' };
  }
  if (expectedType && job.type !== expectedType) {
    return { ok: false, status: 'missing', error: '后台任务类型不匹配' };
  }
  return {
    ok: true,
    jobId: job.jobId,
    recordId: job.recordId,
    status: job.status,
    message: job.message,
    error: job.error,
    videoUrl: job.videoUrl,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    completedAt: job.completedAt || ''
  };
}

function findRunningCompleteJob(recordId, lockId) {
  for (const job of completeJobs.values()) {
    if (job.recordId === recordId && job.lockId === lockId && job.status === 'processing') {
      return job;
    }
  }
  return null;
}

async function releaseOrder(body) {
  requireFeishuConfig();
  const recordId = String(body?.recordId || '').trim();
  const lockId = String(body?.lockId || '').trim();
  const expectedAssignee = String(body?.assignee || '').trim();
  const expectedPlatform = String(body?.platform || '').trim();
  const reason = String(body?.reason || '用户释放任务').trim();
  if (!recordId || !lockId) {
    throw new Error('缺少 recordId 或 lockId');
  }
  const record = await getRecord(recordId);
  if (fieldText(record.fields[config.fields.lockId]) !== lockId) {
    throw new Error('接单锁不匹配，不能释放');
  }
  if (fieldText(record.fields[config.fields.status]) !== config.statuses.inProgress) {
    throw new Error('只有接单中的任务可以释放');
  }
  const assignee = fieldText(record.fields[config.fields.assignee]) || '未知接单人';
  const platform = fieldText(record.fields[config.fields.platform]);
  if (expectedAssignee && assignee !== expectedAssignee) {
    throw new Error('接单人不匹配，不能释放');
  }
  if (expectedPlatform && platform !== expectedPlatform) {
    throw new Error(`当前任务不属于 ${expectedPlatform} 工作台`);
  }
  if (findRunningCompleteJob(recordId, lockId)) {
    throw new Error('视频正在转存，暂时不能释放');
  }
  await resetRecordForRetry(record, `${assignee} 释放任务：${reason}`);
  releaseOmniFlowReservations(recordId, lockId);
  return { ok: true };
}

async function findPendingRecord() {
  const records = await listPendingRecords();
  return records.find((record) => fieldText(record.fields[config.fields.status]) === config.statuses.pending) || null;
}

async function getOrderStats() {
  requireFeishuConfig();
  if (orderStatsCache.value && Date.now() < orderStatsCache.expiresAt) {
    return orderStatsCache.value;
  }
  if (orderStatsCache.value) {
    void refreshOrderStats().catch((error) => {
      console.warn('order stats background refresh failed:', publicError(error));
    });
    return orderStatsCache.value;
  }
  return refreshOrderStats();
}

async function refreshOrderStats() {
  if (orderStatsCache.refreshPromise) {
    return orderStatsCache.refreshPromise;
  }
  orderStatsCache.refreshPromise = loadOrderStats()
    .then((value) => {
      orderStatsCache.value = value;
      orderStatsCache.expiresAt = Date.now() + ORDER_STATS_CACHE_TTL_MS;
      return value;
    })
    .finally(() => {
      orderStatsCache.refreshPromise = null;
    });
  return orderStatsCache.refreshPromise;
}

async function loadOrderStats() {
  const token = await getTenantToken();
  const [total, pending, inProgress, done, garbage] = await Promise.all([
    countRecords('', token, 0),
    countRecords(statusFilter(config.statuses.pending), token, 150),
    countRecords(statusFilter(config.statuses.inProgress), token, 300),
    countRecords(statusFilter(config.statuses.done), token, 450),
    countRecords(statusFilter(config.statuses.garbage), token, 600)
  ]);
  return {
    ok: true,
    counts: {
      pending,
      inProgress,
      done,
      garbage,
      other: Math.max(0, total - pending - inProgress - done - garbage),
      total
    }
  };
}

function statusFilter(status) {
  const field = String(config.fields.status).replace(/\\/g, '\\\\').replace(/\]/g, '\\]');
  const value = String(status).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return `CurrentValue.[${field}]="${value}"`;
}

async function retryUnarchivedVideos(body) {
  requireAdminKey(body);
  requireFeishuConfig();
  if (!config.archive.enabled) {
    throw new Error('OSS_ARCHIVE_ENABLED 未开启，不能补归档');
  }
  if (!config.archive.writeBack) {
    throw new Error('OSS_ARCHIVE_WRITE_BACK 未开启，补归档成功后不会回填表格');
  }
  if (!isArchiveConfigured()) {
    throw new Error('R2 归档配置不完整，请先配置 R2_BUCKET 和 R2_PUBLIC_BASE_URL');
  }

  const limit = clampNumber(Number(body?.limit || 50), 1, 500);
  const dryRun = Boolean(body?.dryRun);
  const records = await listRecords();
  const candidates = [];
  for (const record of records) {
    if (candidates.length >= limit) {
      break;
    }
    const fields = record.fields || {};
    const status = fieldText(fields[config.fields.status]);
    if (status !== config.statuses.done) {
      continue;
    }
    let videoUrl = normalizeHttpUrl(fieldText(fields[config.fields.videoUrl]));
    if (!videoUrl) {
      continue;
    }
    let brokenPublicUrl = '';
    if (isArchivedUrl(videoUrl)) {
      if (await isArchivePublicUrlReadable(videoUrl)) {
        continue;
      }
      brokenPublicUrl = videoUrl;
      videoUrl = extractOriginalSourceUrl(fieldText(fields[config.fields.log]));
      if (!videoUrl || isArchivedUrl(videoUrl)) {
        continue;
      }
    }
    candidates.push({
      recordId: record.record_id,
      assignee: fieldText(fields[config.fields.assignee]) || '系统补归档',
      videoUrl,
      brokenPublicUrl
    });
  }

  if (!dryRun) {
    for (const item of candidates) {
      if (item.brokenPublicUrl) {
        const record = records.find((candidate) => candidate.record_id === item.recordId);
        const previousLog = fieldText(record?.fields?.[config.fields.log]);
        await updateRecord(item.recordId, {
          [config.fields.status]: config.statuses.inProgress,
          [config.fields.lastError]: '检测到 R2 对象不存在，正在重新归档',
          [config.fields.log]: appendLog(previousLog, `系统于 ${nowText()} 检测到 R2 链接不可访问，已使用源地址重新归档：${item.videoUrl}`)
        });
      }
      queueVideoArchive({
        recordId: item.recordId,
        assignee: item.assignee,
        videoUrl: item.videoUrl,
        source: 'retry'
      });
    }
  }

  return {
    ok: true,
    dryRun,
    matched: candidates.length,
    queued: dryRun ? 0 : candidates.length,
    queueSize: archiveQueue.length,
    running: archiveRunning,
    items: candidates.map((item) => ({
      recordId: item.recordId,
      videoUrl: item.videoUrl,
      brokenPublicUrl: item.brokenPublicUrl || ''
    }))
  };
}

function requireAdminKey(body) {
  if (!config.adminKey) {
    throw new Error('后端缺少 MAILAB_ADMIN_KEY，不能执行管理员补归档');
  }
  const key = String(body?.adminKey || body?.key || '').trim();
  if (!key || key !== config.adminKey) {
    throw new Error('管理员密钥无效');
  }
}

async function rollbackOrder(record, assignee, error) {
  const message = publicError(error);
  await resetRecordForRetry(record, `${assignee} 失败一次：${message}`, message);
}

async function resetRecordForRetry(record, logLine, lastError = '') {
  const currentFailCount = Number(fieldText(record.fields[config.fields.failCount]) || 0);
  const nextFailCount = currentFailCount + 1;
  const shouldGarbage = nextFailCount >= config.maxFailCount;
  const status = shouldGarbage ? config.statuses.garbage : config.statuses.pending;
  const reason = shouldGarbage
    ? `${logLine}；已失败 ${nextFailCount} 次，标记为垃圾任务`
    : logLine;
  await updateRecord(record.record_id, {
    [config.fields.status]: status,
    [config.fields.assignee]: '',
    [config.fields.claimedAt]: null,
    [config.fields.lockId]: '',
    [config.fields.platform]: '',
    [config.fields.failCount]: nextFailCount,
    [config.fields.lastError]: lastError,
    [config.fields.log]: appendLog(fieldText(record.fields[config.fields.log]), `${reason}（${nowText()}）`)
  });
}

function assertLock(record, lockId, assignee) {
  const fields = record.fields || {};
  if (fieldText(fields[config.fields.lockId]) !== lockId) {
    throw new Error('接单锁不匹配，可能已被其他人处理');
  }
  if (fieldText(fields[config.fields.assignee]) !== assignee) {
    throw new Error('接单人不匹配');
  }
  if (fieldText(fields[config.fields.status]) !== config.statuses.inProgress) {
    throw new Error('任务不是接单中状态');
  }
}

async function runWatermarkRemoval(watermarkUrl) {
  const publicDoubaoThreadUrl = config.doubaoLocalResolve ? normalizeDoubaoThreadUrl(watermarkUrl) : '';
  if (publicDoubaoThreadUrl) {
    try {
      return await resolveDoubaoThreadVideo(publicDoubaoThreadUrl, { timeoutMs: 30000 });
    } catch (error) {
      console.warn(`[doubao-local] ${publicError(error)}；改用 ${config.watermarkProvider} 兜底`);
    }
  }
  if (config.watermarkProvider === 'zhuceka') {
    return runZhucekaWatermarkRemoval(watermarkUrl);
  }
  if (config.watermarkProvider === 'qsy') {
    return runQsyWatermarkRemoval(watermarkUrl);
  }
  return runDoubaoWatermarkRemoval(watermarkUrl);
}

async function runDoubaoWatermarkRemoval(watermarkUrl) {
  const normalized = normalizeDoubaoUrl(watermarkUrl);
  if (!normalized) {
    throw new Error('未识别到豆包分享链接');
  }

  const submit = await doubaoPost('/api/thread-process', { url: normalized, from: 'mailab-order-server' });
  const directUrl = extractVideoUrl(submit);
  if (directUrl) {
    return directUrl;
  }
  const taskIds = Array.isArray(submit.task_ids) && submit.task_ids.length
    ? submit.task_ids
    : (submit.task_id ? [submit.task_id] : []);
  if (!taskIds.length) {
    throw new Error('去水印服务未返回任务 ID');
  }

  for (const taskId of taskIds) {
    const url = await pollDoubaoTask(taskId);
    if (url) {
      return url;
    }
  }
  throw new Error('去水印等待超时');
}

async function runZhucekaWatermarkRemoval(watermarkUrl) {
  const sourceUrl = normalizeHttpUrl(watermarkUrl);
  if (!sourceUrl) {
    throw new Error('去水印链接无效');
  }
  if (!config.zhucekaUid || !config.zhucekaKey) {
    throw new Error('后端缺少 ZHUCEKA_UID 或 ZHUCEKA_KEY 配置');
  }

  const apiUrl = new URL(config.zhucekaApiUrl);
  apiUrl.searchParams.set('type', 'dsp');
  apiUrl.searchParams.set('uid', config.zhucekaUid);
  apiUrl.searchParams.set('key', config.zhucekaKey);
  apiUrl.searchParams.set('url', sourceUrl);

  const response = await fetchWithTimeout(apiUrl.toString(), {
    headers: { accept: 'application/json' }
  }, 45000);
  const data = await safeJson(response);
  if (!response.ok) {
    throw new Error(data.error || data.msg || `注册卡去水印接口失败 HTTP ${response.status}`);
  }
  if (Number(data.code) !== 200) {
    throw new Error(data.msg || '注册卡去水印接口解析失败');
  }
  const videoUrl = normalizeHttpUrl(data?.data?.video || '');
  if (!videoUrl) {
    throw new Error(data.msg || '注册卡去水印接口未返回视频地址');
  }
  return videoUrl;
}

async function runQsyWatermarkRemoval(watermarkUrl) {
  const url = normalizeHttpUrl(watermarkUrl);
  if (!url) {
    throw new Error('去水印链接无效');
  }
  if (!config.qsyOpenid) {
    throw new Error('后端缺少 QSY_OPENID 配置');
  }

  const signed = signQsyRequest(url);
  const response = await fetchWithTimeout(`${config.qsyBaseUrl.replace(/\/+$/, '')}/watermark/dy/v2/`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'user-agent': config.qsyUserAgent || 'Mozilla/5.0 MicroMessenger MiniProgramEnv',
      referer: config.qsyReferer,
      xweb_xhr: '1',
      'sec-fetch-site': 'cross-site',
      'sec-fetch-mode': 'cors',
      'sec-fetch-dest': 'empty'
    },
    body: JSON.stringify({
      timestamp: signed.timestamp,
      url,
      nonceStr: signed.nonce,
      sign: signed.sign,
      openid: config.qsyOpenid
    })
  }, 30000);
  const data = await safeJson(response);
  if (!response.ok) {
    throw new Error(data.error || `小程序去水印接口失败 HTTP ${response.status}`);
  }

  const mediaUrl = extractQsyMediaUrl(data);
  if (!mediaUrl) {
    throw new Error(data?.msg || '小程序接口未返回可用媒体地址');
  }
  if (/tip\.mp4/i.test(mediaUrl)) {
    throw new Error('小程序接口提示不支持此链接');
  }
  return mediaUrl;
}

function queueVideoArchive({ recordId, lockId = '', assignee, videoUrl, source, flowShareUrl = '', completeJobId = '' }) {
  if (!config.archive.enabled) {
    return false;
  }
  const key = archiveJobKey(recordId, videoUrl);
  if (archiveQueuedKeys.has(key)) {
    return false;
  }
  archiveQueuedKeys.add(key);
  archiveQueue.push({
    key,
    recordId,
    lockId,
    assignee,
    videoUrl,
    source,
    flowShareUrl,
    completeJobId,
    download: null,
    downloadStarted: false
  });
  primeArchiveDownloads();
  drainArchiveQueue();
  return true;
}

function drainArchiveQueue() {
  while (archiveRunning < config.archive.concurrency && archiveQueue.length && canRunArchiveJob(archiveQueue[0])) {
    const job = archiveQueue.shift();
    ensureArchiveDownloadStarted(job);
    archiveRunning += 1;
    runVideoArchive(job)
      .catch((error) => {
        console.error('video archive failed', publicError(error));
      })
      .finally(() => {
        archiveQueuedKeys.delete(job.key);
        releaseArchivePreparedSlot(job);
        archiveRunning -= 1;
        primeArchiveDownloads();
        drainArchiveQueue();
      });
  }
}

function primeArchiveDownloads() {
  for (const job of archiveQueue) {
    if (archivePreparedSlots >= config.archive.maxPreparedFiles) {
      return;
    }
    ensureArchiveDownloadStarted(job);
  }
}

function canRunArchiveJob(job) {
  return Boolean(job?.download) || archivePreparedSlots < config.archive.maxPreparedFiles;
}

function ensureArchiveDownloadStarted(job) {
  if (job.download) {
    return job.download;
  }
  archivePreparedSlots += 1;
  job.downloadStarted = true;
  job.slotReleased = false;
  job.download = startArchiveDownload(job.videoUrl).then((result) => {
    if (!result?.ok || result.archived) {
      releaseArchivePreparedSlot(job);
      primeArchiveDownloads();
      drainArchiveQueue();
    }
    return result;
  });
  return job.download;
}

function releaseArchivePreparedSlot(job) {
  if (!job?.downloadStarted || job.slotReleased) {
    return;
  }
  job.slotReleased = true;
  archivePreparedSlots = Math.max(0, archivePreparedSlots - 1);
}

function archiveJobKey(recordId, videoUrl) {
  return `${recordId || ''}::${normalizeHttpUrl(videoUrl) || videoUrl || ''}`;
}

async function startArchiveDownload(videoUrl) {
  if (!isArchiveConfigured()) {
    return { ok: false, error: new Error('R2 归档配置不完整：需要 R2_BUCKET / R2_PUBLIC_BASE_URL，并确保 Wrangler CLI 已登录或配置 CLOUDFLARE_API_TOKEN') };
  }
  if (config.archive.provider !== 'wrangler-r2') {
    return { ok: false, error: new Error(`暂不支持的 OSS_PROVIDER：${config.archive.provider}`) };
  }
  const sourceUrl = normalizeHttpUrl(videoUrl);
  if (!sourceUrl) {
    return { ok: false, error: new Error('视频链接无效，无法归档') };
  }
  if (isArchivedUrl(sourceUrl)) {
    if (await isArchivePublicUrlReadable(sourceUrl)) {
      return { ok: true, archived: { publicUrl: sourceUrl, objectKey: '', skipped: true }, sourceUrl };
    }
    return { ok: false, error: new Error(`R2 对象不存在或不可访问：${sourceUrl}`), sourceUrl };
  }
  try {
    const file = await downloadVideoForArchive(sourceUrl);
    return { ok: true, file, sourceUrl };
  } catch (error) {
    return { ok: false, error };
  }
}

async function runVideoArchive({ recordId, lockId, assignee, videoUrl, source, flowShareUrl, completeJobId, download }) {
  const startedAt = nowText();
  try {
    const archived = await archivePreparedVideoWithRetry(download, videoUrl, { recordId, assignee, source });
    const latest = await getRecord(recordId);
    if (source === 'omni') {
      assertLock(latest, lockId, assignee);
    }
    const writeBackText = config.archive.writeBack ? '；已回填 R2 视频地址' : '';
    const sourceForLog = source === 'omni' && flowShareUrl ? flowShareUrl : videoUrl;
    const line = source === 'omni'
      ? `${assignee} 于 ${startedAt} 完成 Omni 视频转存：${archived.publicUrl}；Flow 分享链接：${sourceForLog}`
      : `${assignee} 于 ${startedAt} 归档视频成功：${archived.publicUrl}；源地址：${sourceForLog}${writeBackText}`;
    const fields = {
      [config.fields.status]: config.statuses.done,
      [config.fields.completedAt]: Date.now(),
      [config.fields.lastError]: '',
      ...(source === 'omni' ? {
        [config.fields.platform]: 'Omni',
        [config.fields.watermarkUrl]: hyperlinkField(flowShareUrl)
      } : {}),
      [config.fields.log]: appendLog(fieldText(latest.fields?.[config.fields.log]), line)
    };
    if (config.archive.writeBack && archived.publicUrl) {
      fields[config.fields.videoUrl] = textUrlField(archived.publicUrl);
    }
    await updateRecord(recordId, fields);
    finishOmniCompleteJob(completeJobId, {
      status: 'completed',
      message: 'R2 转存成功，已回填飞书并完成订单',
      videoUrl: archived.publicUrl,
      completedAt: nowText()
    });
  } catch (error) {
    const latest = await getRecord(recordId).catch(() => null);
    const line = `${assignee} 于 ${startedAt} 归档视频失败：${publicError(error)}`;
    const stillOwnsOrder = source !== 'omni' || (
      fieldText(latest?.fields?.[config.fields.lockId]) === lockId
      && fieldText(latest?.fields?.[config.fields.assignee]) === assignee
      && fieldText(latest?.fields?.[config.fields.status]) === config.statuses.inProgress
    );
    if (stillOwnsOrder) {
      await updateRecord(recordId, {
        [config.fields.lastError]: `归档视频失败：${publicError(error)}`,
        [config.fields.log]: appendLog(fieldText(latest?.fields?.[config.fields.log]), line)
      }).catch((updateError) => {
        console.error('archive log update failed', updateError);
      });
    }
    finishOmniCompleteJob(completeJobId, {
      status: 'failed',
      message: 'R2 转存失败，订单保持接单中，可重试或释放',
      error: publicError(error)
    });
    throw error;
  }
}

function finishOmniCompleteJob(jobId, patch) {
  if (!jobId) {
    return;
  }
  const job = completeJobs.get(jobId);
  if (!job || job.type !== 'omni') {
    return;
  }
  Object.assign(job, patch, { updatedAt: Date.now() });
  setTimeout(() => {
    completeJobs.delete(jobId);
  }, 30 * 60 * 1000);
}

async function archivePreparedVideoWithRetry(download, videoUrl, context = {}) {
  if (!isArchiveConfigured()) {
    throw new Error('R2 归档配置不完整：需要 R2_BUCKET / R2_PUBLIC_BASE_URL，并确保 Wrangler CLI 已登录或配置 CLOUDFLARE_API_TOKEN');
  }
  if (config.archive.provider !== 'wrangler-r2') {
    throw new Error(`暂不支持的 OSS_PROVIDER：${config.archive.provider}`);
  }

  const prepared = await download;
  if (!prepared?.ok) {
    throw prepared?.error || new Error('视频下载失败，无法归档');
  }
  if (prepared.archived) {
    return prepared.archived;
  }

  const file = prepared.file;
  const sourceUrl = prepared.sourceUrl || normalizeHttpUrl(videoUrl);
  const objectKey = createArchiveObjectKey(sourceUrl, context);
  const publicUrl = publicArchiveUrl(objectKey);
  try {
    let lastError = null;
    for (let attempt = 1; attempt <= config.archive.maxAttempts; attempt += 1) {
      try {
        await uploadCloudflareR2ObjectWithWrangler(objectKey, file.path, file.contentType);
        await verifyArchivePublicUrl(publicUrl);
        return { publicUrl, objectKey, skipped: false };
      } catch (error) {
        lastError = error;
        if (attempt >= config.archive.maxAttempts || !isRetryableArchiveError(error)) {
          throw error;
        }
        console.warn(`video archive retry ${attempt}/${config.archive.retryCount}:`, publicError(error));
        await delay(config.archive.retryDelayMs * attempt);
      }
    }
    throw lastError || new Error('视频归档失败');
  } finally {
    await fs.promises.unlink(file.path).catch(() => {});
  }
}

function isRetryableArchiveError(error) {
  const message = String(error?.message || error || '');
  return /fetch failed|fetch request failed|connectivity|network|timeout|timed out|ETIMEDOUT|ECONNRESET|ECONNREFUSED|EAI_AGAIN|ENOTFOUND|EPIPE|网关|超时|网络/i.test(message);
}

function isArchiveConfigured() {
  return Boolean(config.archive.bucket && config.archive.publicBaseUrl);
}

async function downloadVideoForArchive(videoUrl) {
  let lastError = null;
  for (let attempt = 1; attempt <= config.archive.maxAttempts; attempt += 1) {
    try {
      return await downloadVideoForArchiveOnce(videoUrl);
    } catch (error) {
      lastError = error;
      if (attempt >= config.archive.maxAttempts || !isRetryableArchiveError(error)) {
        throw error;
      }
      console.warn(`video download retry ${attempt}/${config.archive.retryCount}:`, publicError(error));
      await delay(config.archive.retryDelayMs * attempt);
    }
  }
  throw lastError || new Error('视频归档下载失败');
}

async function downloadVideoForArchiveOnce(videoUrl) {
  const response = await fetchWithTimeout(videoUrl, {
    redirect: 'follow',
    headers: {
      accept: 'video/mp4,video/*,*/*;q=0.8',
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
    }
  }, config.archive.downloadTimeoutMs, '视频归档下载超时');
  if (!response.ok) {
    throw new Error(`视频归档下载失败 HTTP ${response.status}`);
  }

  const responseContentType = String(response.headers.get('content-type') || '').toLowerCase();
  if (/text\/html|application\/json|text\/plain/.test(responseContentType)) {
    throw new Error(`视频链接返回了非视频内容：${responseContentType}`);
  }

  const contentLength = Number(response.headers.get('content-length') || 0);
  if (contentLength && contentLength > config.archive.maxBytes) {
    throw new Error(`视频超过归档限制：${Math.ceil(contentLength / 1024 / 1024)}MB`);
  }

  const tempDir = path.join(os.tmpdir(), 'mailab-r2-archive');
  await fs.promises.mkdir(tempDir, { recursive: true });
  const tempFile = path.join(tempDir, `${crypto.randomUUID()}${videoExtension(videoUrl)}`);
  try {
    const buffer = Buffer.from(await response.arrayBuffer());
    if (!buffer.length) {
      throw new Error('视频下载为空，无法归档');
    }
    if (buffer.length > config.archive.maxBytes) {
      throw new Error(`视频超过归档限制：${Math.ceil(buffer.length / 1024 / 1024)}MB`);
    }
    await fs.promises.writeFile(tempFile, buffer);
    return {
      path: tempFile,
      contentType: normalizeVideoContentType(response.headers.get('content-type') || '', videoUrl)
    };
  } catch (error) {
    await fs.promises.unlink(tempFile).catch(() => {});
    throw error;
  }
}

async function uploadCloudflareR2ObjectWithWrangler(objectKey, filePath, contentType) {
  try {
    const args = [
      'r2',
      'object',
      'put',
      `${config.archive.bucket}/${objectKey}`,
      '--file',
      filePath,
      '--content-type',
      contentType,
      '--remote'
    ];
    if (config.archive.jurisdiction) {
      args.push('--jurisdiction', config.archive.jurisdiction);
    }
    await execFileAsync(config.archive.wranglerBin, args, {
      cwd: config.archive.wranglerCwd || undefined,
      timeout: config.archive.uploadTimeoutMs,
      maxBuffer: 1024 * 1024,
      env: wranglerEnv()
    });
  } catch (error) {
    if (error?.code === 'ENOENT') {
      throw new Error(`R2 归档上传失败：找不到 Wrangler CLI（${config.archive.wranglerBin}）。请在服务器安装 wrangler，或把 CLOUDFLARE_WRANGLER_BIN 配置为绝对路径`);
    }
    const detail = [error?.stderr, error?.stdout, error?.message].filter(Boolean).join('\n').slice(0, 360);
    throw new Error(`R2 归档上传失败：${detail || 'Wrangler CLI 执行失败'}`);
  }
}

function wranglerEnv() {
  const nextEnv = { ...process.env };
  if (config.archive.cloudflareApiToken) {
    nextEnv.CLOUDFLARE_API_TOKEN = config.archive.cloudflareApiToken;
  }
  if (config.archive.cloudflareAccountId) {
    nextEnv.CLOUDFLARE_ACCOUNT_ID = config.archive.cloudflareAccountId;
  }
  return nextEnv;
}

function createArchiveObjectKey(sourceUrl, context = {}) {
  const now = new Date();
  const yyyy = String(now.getFullYear());
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const prefix = String(config.archive.prefix || '').trim().replace(/^\/+|\/+$/g, '');
  const recordPart = slugPart(context.recordId || 'record');
  const randomPart = crypto.randomUUID().replace(/-/g, '').slice(0, 16);
  return [prefix, yyyy, mm, dd, `${recordPart}-${randomPart}${videoExtension(sourceUrl)}`].filter(Boolean).join('/');
}

function publicArchiveUrl(objectKey) {
  const baseUrl = String(config.archive.publicBaseUrl || '').trim().replace(/\/+$/, '');
  if (!baseUrl) {
    throw new Error('缺少 R2_PUBLIC_BASE_URL，无法生成归档公开视频地址');
  }
  return `${baseUrl}/${objectKey.split('/').map(encodeUriPathSegment).join('/')}`;
}

async function verifyArchivePublicUrl(publicUrl) {
  const attempts = config.archive.publicVerifyAttempts;
  const separator = publicUrl.includes('?') ? '&' : '?';
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const verifyUrl = `${publicUrl}${separator}mailab_verify=${Date.now()}_${attempt}`;
    const response = await fetchWithTimeout(verifyUrl, {
      method: 'GET',
      headers: {
        range: 'bytes=0-0',
        'cache-control': 'no-cache',
        pragma: 'no-cache'
      },
      redirect: 'follow'
    }, 15000, 'R2 公开链接校验超时');
    if (response.ok || response.status === 206) {
      return;
    }
    if (attempt < attempts && [403, 404, 409, 425, 429, 500, 502, 503, 504].includes(response.status)) {
      await delay(config.archive.publicVerifyDelayMs);
      continue;
    }
    throw new Error(`R2 公开链接不可访问 HTTP ${response.status}：已等待约 ${Math.round((attempts * config.archive.publicVerifyDelayMs) / 1000)} 秒。请检查 R2_PUBLIC_BASE_URL 是否为公开域名根地址，并确认 Bucket 已开启 Public Access。链接：${publicUrl}`);
  }
}

async function isArchivePublicUrlReadable(publicUrl) {
  try {
    const separator = publicUrl.includes('?') ? '&' : '?';
    const response = await fetchWithTimeout(`${publicUrl}${separator}mailab_check=${Date.now()}`, {
      method: 'GET',
      headers: {
        range: 'bytes=0-0',
        'cache-control': 'no-cache',
        pragma: 'no-cache'
      },
      redirect: 'follow'
    }, 15000, 'R2 公开链接检查超时');
    return response.ok || response.status === 206;
  } catch {
    return false;
  }
}

function isArchivedUrl(url) {
  const publicBase = String(config.archive.publicBaseUrl || '').trim().replace(/\/+$/, '');
  return Boolean(publicBase && url.startsWith(publicBase));
}

function extractOriginalSourceUrl(logText) {
  const text = String(logText || '');
  const matches = [...text.matchAll(/源地址[：:]\s*(https?:\/\/[^\s；;]+)/g)];
  return normalizeHttpUrl(matches.at(-1)?.[1] || '');
}

function normalizeVideoContentType(contentType, sourceUrl) {
  const value = String(contentType || '').split(';')[0].trim().toLowerCase();
  if (value && !/json|html|text/i.test(value)) {
    return value;
  }
  const ext = videoExtension(sourceUrl);
  if (ext === '.webm') return 'video/webm';
  if (ext === '.mov') return 'video/quicktime';
  return 'video/mp4';
}

function videoExtension(sourceUrl) {
  try {
    const pathname = new URL(sourceUrl).pathname.toLowerCase();
    const match = pathname.match(/\.(mp4|mov|webm|m4v)$/i);
    return match ? `.${match[1].toLowerCase()}` : '.mp4';
  } catch {
    return '.mp4';
  }
}

function slugPart(value) {
  return String(value || '')
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'record';
}

function encodeUriPathSegment(value) {
  return encodeURIComponent(value).replace(/[!*'()]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}

function signQsyRequest(url) {
  const nonce = generateNonce();
  const timestamp = Math.floor(Date.now() / 1000);
  const raw = `nonceStr=${nonce}&timestamp=${timestamp}&url=${encodeURIComponent(url)}`;
  return {
    nonce,
    timestamp,
    sign: crypto.createHash('md5').update(raw).digest('hex')
  };
}

function generateNonce(length = 16) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let nonce = '';
  for (let i = 0; i < length; i += 1) {
    nonce += chars[Math.floor(Math.random() * chars.length)];
  }
  return nonce;
}

function extractQsyMediaUrl(data) {
  const code = Number(data?.code);
  const body = data?.body || {};
  if (code === 0) {
    const videoInfo = body.video_info || {};
    return normalizeHttpUrl(videoInfo.url_dl || videoInfo.url || videoInfo.url_bk || '');
  }
  if (code === 1) {
    const images = Array.isArray(body.images) ? body.images : [];
    return normalizeHttpUrl(images[0] || '');
  }
  return '';
}

async function pollDoubaoTask(taskId) {
  if (doubaoPolling.has(taskId)) {
    return doubaoPolling.get(taskId);
  }
  const promise = (async () => {
    for (let i = 0; i < 180; i += 1) {
      await delay(i === 0 ? 900 : 2500);
      const data = await doubaoGet(`/api/thread-process/${encodeURIComponent(taskId)}`);
      const videoUrl = extractVideoUrl(data);
      if (videoUrl) {
        return videoUrl;
      }
      if (data.status === 'failed') {
        throw new Error(data.error || '去水印处理失败');
      }
    }
    return '';
  })().finally(() => doubaoPolling.delete(taskId));
  doubaoPolling.set(taskId, promise);
  return promise;
}

async function listRecords() {
  return listRecordsByView('');
}

async function countRecords(filter, token, staggerMs = 0) {
  if (staggerMs > 0) {
    await delay(staggerMs);
  }
  const url = new URL(`https://open.feishu.cn/open-apis/bitable/v1/apps/${config.appToken}/tables/${config.tableId}/records`);
  url.searchParams.set('page_size', '1');
  if (filter) {
    url.searchParams.set('filter', filter);
  }
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await fetch(url, {
      headers: { authorization: `Bearer ${token}` }
    });
    const data = await response.json();
    if (response.ok && data.code === 0) {
      const total = Number(data.data?.total);
      if (!Number.isFinite(total) || total < 0) {
        throw new Error('飞书未返回有效的记录数量');
      }
      return total;
    }
    const error = new Error(data.msg || `读取记录数量失败 HTTP ${response.status}`);
    if (!isFeishuDataNotReady(error) || attempt === 2) {
      throw error;
    }
    await delay(400 * (attempt + 1));
  }
  throw new Error('读取记录数量失败');
}

async function listPendingRecords() {
  const viewId = await getPendingViewId();
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await listRecordsByView(viewId);
    } catch (error) {
      if (!isFeishuDataNotReady(error)) {
        throw error;
      }
      if (attempt === 0) {
        await delay(250);
      }
    }
  }

  console.warn('Feishu pending view is not ready; falling back to table scan');
  const records = await listRecords();
  return records.filter((record) => (
    fieldText(record.fields?.[config.fields.status]) === config.statuses.pending
  ));
}

function isFeishuDataNotReady(error) {
  return /data not ready|数据尚未准备好/i.test(publicError(error));
}

async function listRecordsByView(viewId = '') {
  const token = await getTenantToken();
  const records = [];
  let pageToken = '';
  for (let page = 0; page < 100; page += 1) {
    const url = new URL(`https://open.feishu.cn/open-apis/bitable/v1/apps/${config.appToken}/tables/${config.tableId}/records`);
    url.searchParams.set('page_size', '500');
    if (viewId) {
      url.searchParams.set('view_id', viewId);
    }
    if (pageToken) {
      url.searchParams.set('page_token', pageToken);
    }
    const response = await fetch(url, {
      headers: { authorization: `Bearer ${token}` }
    });
    const data = await response.json();
    if (!response.ok || data.code !== 0) {
      throw new Error(data.msg || `读取记录失败 HTTP ${response.status}`);
    }
    records.push(...(data.data?.items || []));
    if (!data.data?.has_more) {
      return records;
    }
    pageToken = data.data?.page_token || '';
    if (!pageToken) {
      return records;
    }
  }
  throw new Error('读取记录失败：分页超过 100 页');
}

let pendingViewCache = { id: '', expiresAt: 0 };
async function getPendingViewId() {
  if (config.pendingViewId) {
    return config.pendingViewId;
  }
  if (pendingViewCache.id && Date.now() < pendingViewCache.expiresAt) {
    return pendingViewCache.id;
  }
  const token = await getTenantToken();
  const url = new URL(`https://open.feishu.cn/open-apis/bitable/v1/apps/${config.appToken}/tables/${config.tableId}/views`);
  const response = await fetch(url, {
    headers: { authorization: `Bearer ${token}` }
  });
  const data = await response.json();
  if (!response.ok || data.code !== 0) {
    throw new Error(data.msg || `读取视图失败 HTTP ${response.status}`);
  }
  const view = (data.data?.items || data.data?.views || []).find((item) => item.view_name === config.pendingViewName || item.name === config.pendingViewName);
  if (!view?.view_id && !view?.id) {
    throw new Error(`未找到待接单视图：${config.pendingViewName}`);
  }
  pendingViewCache = {
    id: view.view_id || view.id,
    expiresAt: Date.now() + 10 * 60 * 1000
  };
  return pendingViewCache.id;
}

async function getRecord(recordId) {
  const token = await getTenantToken();
  const response = await fetch(`https://open.feishu.cn/open-apis/bitable/v1/apps/${config.appToken}/tables/${config.tableId}/records/${recordId}`, {
    headers: { authorization: `Bearer ${token}` }
  });
  const data = await response.json();
  if (!response.ok || data.code !== 0) {
    throw new Error(data.msg || `读取记录失败 HTTP ${response.status}`);
  }
  return data.data?.record || data.data;
}

async function updateRecord(recordId, fields) {
  const token = await getTenantToken();
  const response = await fetch(`https://open.feishu.cn/open-apis/bitable/v1/apps/${config.appToken}/tables/${config.tableId}/records/${recordId}`, {
    method: 'PUT',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify({ fields })
  });
  const data = await response.json();
  if (!response.ok || data.code !== 0) {
    throw new Error(data.msg || `更新记录失败 HTTP ${response.status}`);
  }
  orderStatsCache.expiresAt = 0;
  return data.data?.record || data.data;
}

async function getTenantToken() {
  requireFeishuConfig();
  if (tokenCache.token && Date.now() < tokenCache.expiresAt) {
    return tokenCache.token;
  }
  const response = await fetch('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      app_id: config.feishuAppId,
      app_secret: config.feishuAppSecret
    })
  });
  const data = await response.json();
  if (!response.ok || data.code !== 0 || !data.tenant_access_token) {
    throw new Error(data.msg || '获取飞书 token 失败');
  }
  tokenCache = {
    token: data.tenant_access_token,
    expiresAt: Date.now() + Math.max(60, Number(data.expire || 7200) - 300) * 1000
  };
  return tokenCache.token;
}

async function doubaoPost(path, body) {
  const headers = { 'content-type': 'application/json' };
  if (config.doubaoAuthToken) {
    headers.authorization = `Bearer ${config.doubaoAuthToken}`;
  } else {
    headers['x-client-from'] = 'chrome';
  }
  const response = await fetch(`${config.doubaoApiOrigin}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body)
  });
  const data = await safeJson(response);
  if (!response.ok || data.ok === false) {
    throw new Error(data.error || `去水印接口失败 HTTP ${response.status}`);
  }
  return data;
}

async function doubaoGet(path) {
  const headers = config.doubaoAuthToken ? { authorization: `Bearer ${config.doubaoAuthToken}` } : {};
  const response = await fetch(`${config.doubaoApiOrigin}${path}`, { headers });
  const data = await safeJson(response);
  if (!response.ok || data.ok === false) {
    throw new Error(data.error || `去水印查询失败 HTTP ${response.status}`);
  }
  return data;
}

async function handleImageProxy(_req, res, url) {
  const imageUrl = url.searchParams.get('url') || '';
  const wantsPreview = url.searchParams.get('preview') === '1';
  const previewWidth = clampNumber(Number(url.searchParams.get('w') || 360), 120, 960);
  const previewQuality = clampNumber(Number(url.searchParams.get('q') || 72), 40, 88);
  if (!/^https?:\/\//i.test(imageUrl)) {
    sendJson(res, 400, { ok: false, error: '图片地址无效' });
    return;
  }
  const response = await fetchWithTimeout(imageUrl, {
    redirect: 'follow',
    headers: imageProxyHeaders(imageUrl)
  }, 30000);
  if (!response.ok) {
    sendJson(res, 502, { ok: false, error: `图片读取失败 HTTP ${response.status}` });
    return;
  }
  const contentType = response.headers.get('content-type') || 'image/png';
  const buffer = Buffer.from(await response.arrayBuffer());
  const preview = wantsPreview ? await compressImagePreview(buffer, contentType, previewWidth, previewQuality) : null;
  res.writeHead(200, {
    'access-control-allow-origin': '*',
    'content-type': preview?.contentType || contentType,
    'cache-control': 'public, max-age=3600'
  });
  res.end(preview?.buffer || buffer);
}

async function compressImagePreview(buffer, contentType, width, quality) {
  if (!/^image\//i.test(contentType) || /svg/i.test(contentType)) {
    return null;
  }
  try {
    const sharp = (await import('sharp')).default;
    const output = await sharp(buffer, { failOn: 'none' })
      .rotate()
      .resize({ width, height: width, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality, mozjpeg: true })
      .toBuffer();
    return { buffer: output, contentType: 'image/jpeg' };
  } catch (error) {
    console.warn('image preview compression skipped:', error.message || error);
    return null;
  }
}

function clampNumber(value, min, max) {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.min(max, Math.max(min, Math.round(value)));
}

function imageProxyHeaders(imageUrl) {
  const headers = {
    accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
    'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
    'cache-control': 'no-cache',
    pragma: 'no-cache',
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
  };
  try {
    const parsed = new URL(imageUrl);
    headers.referer = `${parsed.origin}/`;
  } catch {}
  return headers;
}

function requireFeishuConfig() {
  if (!config.feishuAppId || !config.feishuAppSecret || !config.appToken || !config.tableId) {
    throw new Error('后端缺少飞书配置：FEISHU_APP_ID / FEISHU_APP_SECRET / FEISHU_APP_TOKEN / FEISHU_TABLE_ID');
  }
}

function normalizeClaimPlatform(value) {
  const platform = String(value || '').trim();
  if (!platform) {
    return '';
  }
  if (!CLAIM_PLATFORMS.has(platform)) {
    throw new Error('不支持的制作平台');
  }
  return platform;
}

function normalizeFlowShareUrl(value) {
  const text = String(value || '').trim();
  if (!text || text.length > 2048) {
    return '';
  }
  let url;
  try {
    url = new URL(text);
  } catch {
    return '';
  }
  if (url.protocol !== 'https:' || url.hostname !== FLOW_HOST || url.username || url.password) {
    return '';
  }
  const match = url.pathname.match(FLOW_SHARE_PATH);
  if (!match) {
    return '';
  }
  return `https://${FLOW_HOST}/fx/tools/flow/shared/video/${match[1].toLowerCase()}`;
}

function flowVideoSourceUrl(flowShareUrl) {
  const normalized = normalizeFlowShareUrl(flowShareUrl);
  const match = normalized && new URL(normalized).pathname.match(FLOW_SHARE_PATH);
  if (!match) {
    throw new Error('Flow 视频分享链接无效');
  }
  return `https://${FLOW_HOST}/fx/api/og-video/shared/${match[1].toLowerCase()}`;
}

function reserveOmniFlow(flowShareUrl, recordId, lockId) {
  cleanupOmniFlowReservations();
  const normalized = normalizeFlowShareUrl(flowShareUrl);
  const match = normalized && new URL(normalized).pathname.match(FLOW_SHARE_PATH);
  const videoId = String(match?.[1] || '').toLowerCase();
  if (!videoId) {
    throw new Error('Flow 视频分享链接无效');
  }
  const existing = omniFlowReservations.get(videoId);
  if (existing && (existing.recordId !== recordId || existing.lockId !== lockId)) {
    throw new Error('这个 Flow 视频已经绑定到另一个订单，请检查任务对应关系');
  }
  omniFlowReservations.set(videoId, {
    recordId,
    lockId,
    expiresAt: Date.now() + OMNI_FLOW_RESERVATION_TTL_MS
  });
  return { videoId, created: !existing };
}

function cleanupOmniFlowReservations() {
  const now = Date.now();
  for (const [videoId, reservation] of omniFlowReservations) {
    if (!reservation?.expiresAt || reservation.expiresAt <= now) {
      omniFlowReservations.delete(videoId);
    }
  }
}

function releaseOmniFlowReservations(recordId, lockId = '') {
  for (const [videoId, reservation] of omniFlowReservations) {
    if (reservation.recordId === recordId && (!lockId || reservation.lockId === lockId)) {
      omniFlowReservations.delete(videoId);
    }
  }
}

function normalizeDoubaoUrl(value) {
  const text = String(value || '').trim();
  const match = text.match(/https:\/\/www\.doubao\.com\/(?:thread\/[^\s"'<>]+|video-sharing\?[^\s"'<>]+)/);
  if (!match) {
    return '';
  }
  try {
    const url = new URL(match[0].replace(/\\u0026/g, '&'));
    if (url.pathname.startsWith('/thread/')) {
      return `${url.origin}${url.pathname}`;
    }
    if (url.pathname.includes('/video-sharing') && url.searchParams.get('share_id') && (url.searchParams.get('video_id') || url.searchParams.get('vid'))) {
      return url.toString();
    }
  } catch {
    return '';
  }
  return '';
}

function normalizeHttpUrl(value) {
  const match = String(value || '').trim().match(/https?:\/\/[^\s"'<>]+/i);
  if (!match) {
    return '';
  }
  try {
    return new URL(match[0].replace(/\\u0026/g, '&')).toString();
  } catch {
    return '';
  }
}

function extractVideoUrl(value, depth = 0) {
  if (depth > 4 || value == null) {
    return '';
  }
  if (typeof value === 'string') {
    return normalizeHttpUrl(value);
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const url = extractVideoUrl(item, depth + 1);
      if (url) return url;
    }
    return '';
  }
  if (typeof value === 'object') {
    const preferredKeys = ['url', 'video_url', 'videoUrl', 'download_url', 'downloadUrl', 'play_url', 'playUrl', 'src'];
    for (const key of preferredKeys) {
      if (key in value) {
        const url = extractVideoUrl(value[key], depth + 1);
        if (url) return url;
      }
    }
    for (const item of Object.values(value)) {
      const url = extractVideoUrl(item, depth + 1);
      if (url) return url;
    }
  }
  return '';
}

function fieldText(value) {
  if (value == null) {
    return '';
  }
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (Array.isArray(value)) {
    return value.map(fieldText).filter(Boolean).join('');
  }
  if (typeof value === 'object') {
    if ('text' in value) return fieldText(value.text);
    if ('name' in value) return fieldText(value.name);
    if ('link' in value) return fieldText(value.link);
    if ('url' in value) return fieldText(value.url);
    return '';
  }
  return String(value);
}

function textUrlField(value) {
  const url = String(value || '').trim();
  return url || null;
}

function hyperlinkField(value) {
  const url = String(value || '').trim();
  return url ? { text: url, link: url } : null;
}

function appendLog(previous, line) {
  return [String(previous || '').trim(), line].filter(Boolean).join('\n');
}

function nowText() {
  const date = new Date();
  const pad = (num) => String(num).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

async function safeJson(response) {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    return { ok: false, error: text.slice(0, 160) || '接口返回异常' };
  }
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 30000, timeoutMessage = '请求超时') {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new Error(timeoutMessage);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function publicError(error) {
  const message = String(error?.message || error || '');
  return /<!doctype\s+html|<html[\s>]/i.test(message) ? '服务返回异常，请稍后重试' : message;
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8');
      if (!text) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(text));
      } catch (error) {
        reject(new Error('请求 JSON 无效'));
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res, status, data) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'access-control-allow-origin': allowedOrigin(),
    'access-control-allow-methods': 'GET,POST,OPTIONS',
    'access-control-allow-headers': 'content-type,authorization'
  });
  res.end(JSON.stringify(data));
}

function handleCors(req, res) {
  if (req.method !== 'OPTIONS') {
    return false;
  }
  res.writeHead(204, {
    'access-control-allow-origin': allowedOrigin(),
    'access-control-allow-methods': 'GET,POST,OPTIONS',
    'access-control-allow-headers': 'content-type,authorization',
    'access-control-max-age': '86400'
  });
  res.end();
  return true;
}

function allowedOrigin() {
  return config.allowedOrigins.includes('*') ? '*' : config.allowedOrigins[0] || '*';
}

function parseLicenseKeys(value) {
  const text = String(value || '').trim();
  const licenses = new Map();
  if (!text) {
    return licenses;
  }

  if (text.startsWith('{') || text.startsWith('[')) {
    try {
      const parsed = JSON.parse(text);
      const entries = Array.isArray(parsed)
        ? parsed.map((item) => [item.key, item])
        : Object.entries(parsed);
      for (const [key, license] of entries) {
        addLicense(licenses, key, license);
      }
      return licenses;
    } catch (error) {
      console.warn('MAILAB_LICENSE_KEYS JSON parse failed:', error.message || error);
    }
  }

  for (const item of text.split(',')) {
    const [key, name = '授权用户', expiresAt = '', active = 'true'] = item.split(':').map((part) => part.trim());
    addLicense(licenses, key, {
      name,
      expiresAt,
      active: !/^false|0|no|disabled$/i.test(active)
    });
  }
  return licenses;
}

function addLicense(licenses, key, license) {
  const normalizedKey = String(key || '').trim();
  if (!normalizedKey) return;
  licenses.set(normalizedKey, {
    name: String(license?.name || '授权用户').trim(),
    expiresAt: String(license?.expiresAt || '').trim(),
    active: license?.active !== false
  });
}

function isExpiredDate(value) {
  const text = String(value || '').trim();
  if (!text) return false;
  const date = new Date(`${text}T23:59:59+08:00`);
  if (Number.isNaN(date.getTime())) {
    return false;
  }
  return Date.now() > date.getTime();
}

function loadEnv() {
  const result = { ...process.env };
  try {
    const text = fs.readFileSync(new URL('.env', import.meta.url), 'utf8');
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const index = trimmed.indexOf('=');
      if (index < 0) continue;
      const key = trimmed.slice(0, index).trim();
      const value = trimmed.slice(index + 1).trim();
      if (!(key in result)) {
        result[key] = value;
      }
    }
  } catch {}
  return result;
}

function extractBaseToken(value) {
  const match = String(value || '').match(/\/base\/([^/?#]+)/);
  return match?.[1] || '';
}

function extractQuery(value, key) {
  try {
    return new URL(value).searchParams.get(key) || '';
  } catch {
    return '';
  }
}

function mask(value) {
  const text = String(value || '');
  return text ? `${text.slice(0, 4)}...${text.slice(-4)}` : '';
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
