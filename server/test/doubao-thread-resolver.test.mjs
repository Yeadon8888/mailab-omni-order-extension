import test from 'node:test';
import assert from 'node:assert/strict';
import {
  decodeVideoUrlToken,
  extractFallbackApi,
  normalizeDoubaoThreadUrl,
  resolveDoubaoThreadVideo
} from '../doubao-thread-resolver.mjs';

const keySeed = 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=';
const token = 'qAABAJsxUq3vNy+yC7j4VcQB1n+6pAYAK6S9lerQqtozCi4MDEjhD7ounKZDobpDvCA0y7/RlgvgvupEZEDvbsaDYNSZjXI1FVx4hcVg9wBxIZEL/RDAhaHgcbI4cF3RqEKzeg==';
const expectedVideoUrl = 'https://v3-default.douyin.com/video/test.mp4?lr=unwatermarked&mime_type=video_mp4';

test('decodes a deterministic Doubao qAAB URL token', () => {
  assert.equal(decodeVideoUrlToken(token, keySeed), expectedVideoUrl);
});

test('extracts an entity-escaped fallback_api from a public thread page', () => {
  const html = `before fallback_api\\&quot;:\\&quot;https:\\u002F\\u002Fvas-lf-x.snssdk.com\\u002Fvideo\\u002Ffplay\\u002F1\\u002Fhash\\u002Fvideo?aid=1938&amp;channel=download&amp;key_seed=${encodeURIComponent(keySeed)}\\&quot; after`;
  assert.equal(
    extractFallbackApi(html),
    `https://vas-lf-x.snssdk.com/video/fplay/1/hash/video?aid=1938&channel=download&key_seed=${encodeURIComponent(keySeed)}`
  );
});

test('resolves a public thread through fallback_api and requests the unwatermarked rendition', async () => {
  const requestedUrls = [];
  const fetchImpl = async (input) => {
    const url = new URL(String(input));
    requestedUrls.push(url);
    if (url.hostname === 'www.doubao.com') {
      return new Response(`fallback_api\\&quot;:\\&quot;https://vas-lf-x.snssdk.com/video/fplay/1/hash/video?aid=1938&amp;channel=download&amp;codec_type=3&amp;logo_type=video_gen_watermark_dyn&amp;key_seed=${encodeURIComponent(keySeed)}\\&quot;`);
    }
    return Response.json({
      video_info: {
        data: {
          key_seed: keySeed,
          video_list: {
            video_1: {
              definition: '720p',
              vwidth: 720,
              vheight: 1280,
              bitrate: 3368682,
              main_url: token
            }
          }
        }
      }
    });
  };

  const result = await resolveDoubaoThreadVideo('https://www.doubao.com/thread/test-thread', { fetchImpl });

  assert.equal(result, expectedVideoUrl);
  assert.equal(requestedUrls.length, 2);
  assert.equal(requestedUrls[1].searchParams.get('channel'), 'no');
  assert.equal(requestedUrls[1].searchParams.get('codec_type'), '8');
  assert.equal(requestedUrls[1].searchParams.get('logo_type'), 'unwatermarked');
});

test('rejects unsupported Doubao share types', () => {
  assert.equal(normalizeDoubaoThreadUrl('https://www.doubao.com/video-sharing?share_id=123&video_id=456'), '');
});

function resolveVideoList(videoList) {
  return resolveDoubaoThreadVideo('https://www.doubao.com/thread/test-thread', {
    fetchImpl: async (input) => new URL(String(input)).hostname === 'www.doubao.com'
      ? new Response('fallback_api:"https://vas-lf-x.snssdk.com/video/fplay/test"')
      : Response.json({ video_info: { data: { video_list: videoList } } })
  });
}

test('accepts Doubao-owned video hosts without opening arbitrary domains', async () => {
  const url = 'https://video.doubao.com/test.mp4?lr=unwatermarked';
  assert.equal(await resolveVideoList({ v: { main_url: url } }), url);
});

test('tries a trusted backup rendition instead of failing on the first domain', async () => {
  const result = await resolveVideoList({
    hd: { bitrate: 2000, main_url: 'https://unknown.invalid/test.mp4?lr=unwatermarked', backup_url_1: expectedVideoUrl },
    sd: { bitrate: 1000, main_url: 'https://v9-default.douyin.com/sd.mp4?lr=unwatermarked' }
  });
  assert.equal(result, expectedVideoUrl);
});

test('tries lower quality when the highest quality token cannot be decoded', async () => {
  assert.equal(await resolveVideoList({
    hd: { bitrate: 2000, main_url: 'unreadable-token' },
    sd: { bitrate: 1000, main_url: expectedVideoUrl }
  }), expectedVideoUrl);
});

test('does not choose a watermarked backup when another unwatermarked rendition exists', async () => {
  assert.equal(await resolveVideoList({
    hd: { bitrate: 2000, main_url: 'https://v9-default.douyin.com/hd.mp4?lr=watermarked' },
    sd: { bitrate: 1000, main_url: expectedVideoUrl }
  }), expectedVideoUrl);
});

test('unknown-domain errors identify the host without leaking signed URL parameters', async () => {
  await assert.rejects(resolveVideoList({ v: {
    main_url: 'https://unknown.invalid/private-path.mp4?lr=unwatermarked&token=secret'
  } }), (error) => /非受信任的视频域名/.test(error.message)
    && error.message.includes('unknown.invalid')
    && !/secret|private-path/.test(error.message));
});

test('still rejects lookalike domains, internal addresses, credentials and non-HTTPS URLs', async () => {
  for (const url of [
    'https://doubao.com.evil.invalid/video.mp4?lr=unwatermarked',
    'https://notdoubao.com/video.mp4?lr=unwatermarked',
    'https://127.0.0.1/video.mp4?lr=unwatermarked',
    'https://[::1]/video.mp4?lr=unwatermarked',
    'https://10.0.0.1/video.mp4?lr=unwatermarked',
    'https://video.doubao.com:8443/video.mp4?lr=unwatermarked',
    'https://user:password@video.doubao.com/video.mp4?lr=unwatermarked',
    'http://video.doubao.com/video.mp4?lr=unwatermarked'
  ]) {
    await assert.rejects(resolveVideoList({ v: { main_url: url } }));
  }
});
