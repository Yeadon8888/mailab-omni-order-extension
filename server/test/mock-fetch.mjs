import fs from 'node:fs';

const scenario = process.env.TEST_SCENARIO || 'complete';
const updatesPath = process.env.TEST_UPDATES_PATH || '';
const sourceUrl = 'https://source.test/video.mp4';
const brokenR2Url = 'https://r2.test/mailab/videos/2026/07/20/rec1-deadbeefdeadbeef.mp4';
const flowShareUrl = 'https://labs.google/fx/tools/flow/shared/video/67064cd9-aff7-40cb-b501-521ffc7312cc';
const flowSourceUrl = 'https://labs.google/fx/api/og-video/shared/67064cd9-aff7-40cb-b501-521ffc7312cc';
let mutableFields = {};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' }
  });
}

function recordFields() {
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
      ...mutableFields
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
    ...mutableFields
  };
}

globalThis.fetch = async (input, options = {}) => {
  const url = new URL(String(input));
  const method = String(options.method || 'GET').toUpperCase();

  if (url.pathname.endsWith('/auth/v3/tenant_access_token/internal')) {
    return json({ code: 0, tenant_access_token: 'test-token', expire: 7200 });
  }

  if (url.pathname.endsWith('/records/rec1')) {
    if (method === 'PUT') {
      const body = JSON.parse(String(options.body || '{}'));
      mutableFields = { ...mutableFields, ...(body.fields || {}) };
      if (updatesPath) {
        fs.appendFileSync(updatesPath, `${JSON.stringify(body.fields || {})}\n`);
      }
      return json({ code: 0, data: { record: { record_id: 'rec1', fields: body.fields || {} } } });
    }
    return json({ code: 0, data: { record: { record_id: 'rec1', fields: recordFields() } } });
  }

  if (url.pathname.endsWith('/records') && method === 'GET') {
    return json({
      code: 0,
      data: {
        items: ['retry', 'claim'].includes(scenario) ? [{ record_id: 'rec1', fields: recordFields() }] : [],
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
    if (['complete-success', 'omni-success'].includes(scenario)) {
      return new Response(new Uint8Array([0]), {
        status: 206,
        headers: { 'content-type': 'video/mp4' }
      });
    }
    return new Response('missing', { status: 404 });
  }

  throw new Error(`Unexpected fetch in test: ${method} ${url.href}`);
};
