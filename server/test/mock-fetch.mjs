import fs from 'node:fs';

const scenario = process.env.TEST_SCENARIO || 'complete';
const updatesPath = process.env.TEST_UPDATES_PATH || '';
const sourceUrl = 'https://source.test/video.mp4';
const doubaoVideoUrl = 'https://v9-default.douyin.com/mock-video.mp4?lr=unwatermarked';
const brokenR2Url = 'https://r2.test/mailab/videos/2026/07/20/rec1-deadbeefdeadbeef.mp4';
const flowShareUrl = 'https://labs.google/fx/tools/flow/shared/video/67064cd9-aff7-40cb-b501-521ffc7312cc';
const flowSourceUrl = 'https://labs.google/fx/api/og-video/shared/67064cd9-aff7-40cb-b501-521ffc7312cc';
const mutableFieldsByRecord = new Map();
let statsCountAttempts = 0;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' }
  });
}

function mutableFields(recordId) {
  return mutableFieldsByRecord.get(recordId) || {};
}

function recordFields(recordId = 'rec1') {
  const mutable = mutableFields(recordId);
  if (scenario === 'retry') {
    return {
      任务状态: '已完成',
      接单人: 'tester',
      视频地址: brokenR2Url,
      接单日志: `tester 于 2026-07-20 18:08:26 归档视频成功：${brokenR2Url}；源地址：${sourceUrl}；已回填 R2 视频地址`,
      接单锁ID: 'lock1'
    };
  }
  if (scenario === 'claim') {
    return {
      任务状态: '待接单',
      接单人: '',
      接单锁ID: '',
      提示词: '测试提示词',
      图片地址: 'https://image.test/input.png',
      接单日志: '',
      制作平台: '',
      ...mutable
    };
  }
  if (['batch', 'data-not-ready'].includes(scenario)) {
    return {
      任务状态: '待接单',
      接单人: '',
      接单锁ID: '',
      提示词: `批量测试提示词 ${recordId}`,
      图片地址: `https://image.test/${recordId}.png`,
      接单日志: '',
      制作平台: '',
      ...mutable
    };
  }
  return {
    任务状态: '接单中',
    接单人: 'tester',
    视频地址: '',
    接单日志: '',
    接单锁ID: 'lock1',
    制作平台: 'Omni',
    去水印原始链接: flowShareUrl,
    ...mutable
  };
}

globalThis.fetch = async (input, options = {}) => {
  const url = new URL(String(input));
  const method = String(options.method || 'GET').toUpperCase();

  if (url.pathname.endsWith('/auth/v3/tenant_access_token/internal')) {
    return json({ code: 0, tenant_access_token: 'test-token', expire: 7200 });
  }

  const recordMatch = url.pathname.match(/\/records\/(rec\d+)$/);
  if (recordMatch) {
    const recordId = recordMatch[1];
    if (method === 'PUT') {
      const body = JSON.parse(String(options.body || '{}'));
      const hyperlink = body.fields?.['去水印原始链接'];
      if (hyperlink != null && (
        typeof hyperlink !== 'object'
        || hyperlink.text !== hyperlink.link
        || !String(hyperlink.link || '').startsWith('https://')
      )) {
        return json({ code: 1254068, msg: 'URLFieldConvFail' });
      }
      mutableFieldsByRecord.set(recordId, { ...mutableFields(recordId), ...(body.fields || {}) });
      if (updatesPath) {
        fs.appendFileSync(updatesPath, `${JSON.stringify({ ...(body.fields || {}), __recordId: recordId })}\n`);
      }
      return json({ code: 0, data: { record: { record_id: recordId, fields: body.fields || {} } } });
    }
    return json({ code: 0, data: { record: { record_id: recordId, fields: recordFields(recordId) } } });
  }

  if (url.pathname.endsWith('/records') && method === 'GET') {
    if (['stats-counts', 'stats-counts-retry'].includes(scenario)) {
      statsCountAttempts += 1;
      if (scenario === 'stats-counts-retry' && statsCountAttempts === 1) {
        return json({ code: 1254007, msg: 'Data not ready, please try again later' });
      }
      if (url.searchParams.get('page_size') !== '1') {
        return json({ code: 1254299, msg: 'full table scan is too slow' });
      }
      const filter = url.searchParams.get('filter') || '';
      const totals = { '待接单': 2, '接单中': 3, '已完成': 4, '垃圾任务': 1 };
      const status = Object.keys(totals).find((value) => filter.includes(value));
      return json({
        code: 0,
        data: { items: [], total: status ? totals[status] : 12, has_more: false }
      });
    }
    if (scenario === 'data-not-ready' && url.searchParams.has('view_id')) {
      return json({ code: 1254007, msg: 'Data not ready, please try again later' });
    }
    const items = ['batch', 'data-not-ready'].includes(scenario)
      ? ['rec1', 'rec2', 'rec3', 'rec4', 'rec5'].map((recordId) => ({ record_id: recordId, fields: recordFields(recordId) }))
      : ['retry', 'claim'].includes(scenario) ? [{ record_id: 'rec1', fields: recordFields() }] : [];
    return json({
      code: 0,
      data: {
        items,
        total: items.length,
        has_more: false
      }
    });
  }

  if (url.pathname.endsWith('/views') && method === 'GET') {
    return json({ code: 0, data: { items: [{ view_id: 'view-pending', view_name: '待接单' }] } });
  }

  if (url.href === sourceUrl) {
    return new Response(new Uint8Array([0, 0, 0, 24]), {
      status: 200,
      headers: {
        'content-type': 'video/mp4',
        'content-length': '4'
      }
    });
  }

  if (url.hostname.endsWith('.snssdk.com') && scenario === 'doubao-web-success') {
    return json({
      video_info: {
        data: {
          video_list: {
            video_1: { main_url: doubaoVideoUrl, bitrate: 1000 }
          }
        }
      }
    });
  }

  if (url.href === doubaoVideoUrl) {
    return new Response(new Uint8Array([0, 0, 0, 24]), {
      status: 200,
      headers: {
        'content-type': 'video/mp4',
        'content-length': '4'
      }
    });
  }

  if (url.hostname === 'api.zhuceka.cn' && scenario === 'doubao-web-success') {
    return json({ code: 200, data: { video: sourceUrl }, msg: 'ok' });
  }

  if (url.href === flowSourceUrl) {
    return new Response(new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112]), {
      status: 200,
      headers: {
        'content-type': 'video/mp4',
        'content-length': '8'
      }
    });
  }

  if (url.href.startsWith('https://r2.test/')) {
    if (['complete-success', 'omni-success', 'doubao-web-success'].includes(scenario)) {
      return new Response(new Uint8Array([0]), {
        status: 206,
        headers: { 'content-type': 'video/mp4' }
      });
    }
    return new Response('missing', { status: 404 });
  }

  throw new Error(`Unexpected fetch in test: ${method} ${url.href}`);
};
