import crypto from 'node:crypto';

const FPLAY_KDF_SALT_HEX = '4dd4c2e6b83162090e52b3c7a6733ba4'
  + '1cb2462b829ab58a196b39db57177524'
  + 'f49baf7f08e8d68d26a72e37c1a95a2f'
  + '1f05a51892aef2949732b62a38aadd58';
const MAX_SHARE_HTML_BYTES = 4 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 30000;

export async function resolveDoubaoThreadVideo(shareUrl, options = {}) {
  const normalizedShareUrl = normalizeDoubaoThreadUrl(shareUrl);
  if (!normalizedShareUrl) {
    throw new Error('仅支持公开的豆包 /thread/ 分享链接');
  }

  const fetchImpl = options.fetchImpl || fetch;
  const timeoutMs = Math.max(1000, Number(options.timeoutMs || DEFAULT_TIMEOUT_MS));
  const shareResponse = await fetchWithDeadline(fetchImpl, normalizedShareUrl, {
    headers: {
      accept: 'text/html,application/xhtml+xml',
      'user-agent': 'Mozilla/5.0 (compatible; MAILAB-Doubao-Resolver/1.0)'
    }
  }, timeoutMs);
  if (!shareResponse.ok) {
    throw new Error(`豆包分享页请求失败 HTTP ${shareResponse.status}`);
  }

  const html = await shareResponse.text();
  if (!html || Buffer.byteLength(html) > MAX_SHARE_HTML_BYTES) {
    throw new Error('豆包分享页为空或体积异常');
  }
  const fallbackApi = extractFallbackApi(html);
  if (!fallbackApi) {
    throw new Error('公开分享页中没有 fallback_api');
  }

  const videoInfoUrl = new URL(fallbackApi);
  videoInfoUrl.searchParams.set('channel', 'no');
  videoInfoUrl.searchParams.set('codec_type', '8');
  videoInfoUrl.searchParams.set('logo_type', 'unwatermarked');
  const videoInfoResponse = await fetchWithDeadline(fetchImpl, videoInfoUrl, {
    headers: {
      accept: 'application/json,text/plain,*/*',
      referer: 'https://www.doubao.com/',
      'user-agent': 'Mozilla/5.0 (compatible; MAILAB-Doubao-Resolver/1.0)'
    }
  }, timeoutMs);
  if (!videoInfoResponse.ok) {
    throw new Error(`豆包视频信息请求失败 HTTP ${videoInfoResponse.status}`);
  }

  let payload;
  try {
    payload = await videoInfoResponse.json();
  } catch {
    throw new Error('豆包视频信息不是有效 JSON');
  }
  const data = getVideoData(payload);
  const keySeed = findKeySeed(payload);
  const rejectedHosts = new Set();
  let sawWatermarkedVideo = false;
  for (const token of rankedVideoTokens(data)) {
    const directVideoUrl = decodeVideoUrlToken(token, keySeed);
    if (!directVideoUrl) continue;
    const parsedVideoUrl = new URL(directVideoUrl);
    if (!isTrustedVideoHost(parsedVideoUrl.hostname)) {
      rejectedHosts.add(parsedVideoUrl.hostname);
      continue;
    }
    if (parsedVideoUrl.searchParams.get('lr') !== 'unwatermarked') {
      sawWatermarkedVideo = true;
      continue;
    }
    return directVideoUrl;
  }

  if (rejectedHosts.size) {
    // Hostnames only: signed paths and query parameters must not enter logs.
    throw new Error(`豆包返回了非受信任的视频域名：${[...rejectedHosts].slice(0, 8).join('、')}`);
  }
  if (sawWatermarkedVideo) {
    throw new Error('豆包返回的视频不是无水印版本');
  }
  throw new Error('豆包 qAAB 视频直链解密失败');
}

export function normalizeDoubaoThreadUrl(value) {
  const text = String(value || '').trim();
  const match = text.match(/https:\/\/www\.doubao\.com\/thread\/[^\s"'<>?#]+/i);
  if (!match) return '';
  try {
    const url = new URL(match[0]);
    if (url.protocol !== 'https:' || url.hostname !== 'www.doubao.com' || !/^\/thread\/[^/]+\/?$/.test(url.pathname)) {
      return '';
    }
    return `${url.origin}${url.pathname.replace(/\/$/, '')}`;
  } catch {
    return '';
  }
}

export function extractFallbackApi(html) {
  const text = String(html || '');
  const markerIndex = text.indexOf('fallback_api');
  if (markerIndex < 0) return '';
  const neighborhood = text.slice(Math.max(0, markerIndex - 1000), markerIndex + 8000)
    .replace(/&amp;|&#38;|&#x26;/gi, '&')
    .replace(/\\u0026/gi, '&')
    .replace(/\\u002f/gi, '/')
    .replace(/\\\//g, '/');
  const candidates = neighborhood.match(/https:\/\/[^\s"'<>\\]+/g) || [];
  for (const candidate of candidates) {
    try {
      const url = new URL(candidate);
      if (isTrustedFallbackHost(url.hostname) && url.pathname.includes('/video/fplay/')) {
        return url.toString();
      }
    } catch {
      // Try the next candidate.
    }
  }
  return '';
}

export function decodeVideoUrlToken(token, keySeed = '') {
  const input = String(token || '').trim();
  if (!input) return '';
  if (isHttpsUrl(input)) return input;

  const plainBytes = base64DecodeLoose(input);
  const plainText = plainBytes ? plainBytes.toString('utf8').trim() : '';
  if (isHttpsUrl(plainText)) return plainText;
  if (!input.startsWith('qAAB') || !keySeed) return '';

  try {
    const encrypted = base64DecodeLoose(input);
    const seed = base64DecodeLoose(keySeed);
    if (!encrypted || !seed || encrypted.length < 20) return '';
    if (!encrypted.subarray(0, 4).equals(Buffer.from([0xa8, 0x00, 0x01, 0x00]))) return '';
    const ciphertext = encrypted.subarray(4);
    if (!ciphertext.length || ciphertext.length % 16 !== 0) return '';

    const firstHash = crypto.createHash('sha512').update(seed).digest();
    const salt = Buffer.from(FPLAY_KDF_SALT_HEX, 'hex');
    const derived = crypto.createHash('sha512').update(Buffer.concat([firstHash, salt])).digest();
    const decipher = crypto.createDecipheriv('aes-128-cbc', derived.subarray(0, 16), derived.subarray(16, 32));
    const decoded = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8').trim();
    return isHttpsUrl(decoded) ? decoded : '';
  } catch {
    return '';
  }
}

function getVideoData(payload) {
  const videoInfo = payload?.video_info || payload?.data?.video_info || payload;
  const data = videoInfo?.data || videoInfo;
  return data && typeof data === 'object' ? data : {};
}

function rankedVideoTokens(data) {
  const videoList = data?.video_list;
  const entries = videoList && typeof videoList === 'object' ? Object.values(videoList) : [data];
  const ranked = [];
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') continue;
    const score = Number(entry.bitrate || entry.real_bitrate || 0)
      + Number(entry.vwidth || entry.width || 0) * Number(entry.vheight || entry.height || 0);
    // Try every URL for the same rendition before moving to a lower quality.
    const tokens = [entry.main_url, entry.play_url, entry.backup_url_1, entry.backup_url_2, entry.backup_url]
      .filter((value) => typeof value === 'string' && value.trim()).map((value) => value.trim());
    ranked.push({ tokens, score: Number.isFinite(score) ? score : 0 });
  }
  return [...new Set(ranked.sort((a, b) => b.score - a.score).flatMap((item) => item.tokens))];
}

function findKeySeed(value, depth = 0) {
  if (depth > 10 || value == null) return '';
  if (typeof value === 'string') {
    const match = value.match(/(?:^|[?&])key_seed=([^&"'<>\\\s]+)/i);
    return match ? decodeURIComponent(match[1]) : '';
  }
  if (typeof value !== 'object') return '';
  if (typeof value.key_seed === 'string' && value.key_seed.trim()) return value.key_seed.trim();
  for (const child of Object.values(value)) {
    const result = findKeySeed(child, depth + 1);
    if (result) return result;
  }
  return '';
}

function base64DecodeLoose(value) {
  const input = String(value || '').trim();
  if (!input) return null;
  const variants = [
    input,
    input.replace(/[$@#]/g, (character) => ({ '$': '_', '@': '/', '#': '.' })[character]),
    input.replace(/[$@#]/g, (character) => ({ '$': '+', '@': '/', '#': '=' })[character])
  ];
  for (const candidate of new Set(variants)) {
    try {
      const normalized = candidate.replace(/-/g, '+').replace(/_/g, '/');
      const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
      const decoded = Buffer.from(padded, 'base64');
      if (decoded.length) return decoded;
    } catch {
      // Try the next variant.
    }
  }
  return null;
}

async function fetchWithDeadline(fetchImpl, input, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(input, { ...options, signal: controller.signal, redirect: 'follow' });
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error('豆包解析请求超时');
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function isHttpsUrl(value) {
  try {
    const url = new URL(String(value || ''));
    return url.protocol === 'https:' && !url.username && !url.password && !url.port;
  } catch {
    return false;
  }
}

function isTrustedFallbackHost(hostname) {
  const host = String(hostname || '').toLowerCase();
  return host === 'snssdk.com' || host.endsWith('.snssdk.com');
}

function isTrustedVideoHost(hostname) {
  const host = String(hostname || '').toLowerCase();
  return ['doubao.com', 'douyin.com', 'douyinvod.com', 'bytecdn.cn', 'byteimg.com']
    .some((suffix) => host === suffix || host.endsWith(`.${suffix}`));
}
