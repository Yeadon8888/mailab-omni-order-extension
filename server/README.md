# MAILAB Order Server

Local or cloud backend for the MAILAB Feishu Base order workflow.

## Run

```bash
cp .env.example .env
# Fill FEISHU_APP_ID and FEISHU_APP_SECRET.
npm start
```

Default URL:

```text
http://127.0.0.1:8787
```

For other users to access it, deploy to a cloud server or expose it with a tunnel such as Cloudflare Tunnel.

## APIs

- `GET /api/health`
- `POST /api/claim` with `{ "assignee": "name", "platform": "豆包" | "Omni" }`; the platform is written to `制作平台` when the task is claimed.
- `POST /api/stats` returns current task-pool counts such as pending and in-progress orders.
- `POST /api/complete` with `{ "recordId": "...", "lockId": "...", "assignee": "...", "watermarkUrl": "..." }`; returns quickly with `{ "accepted": true, "jobId": "..." }` and continues processing in the background.
- `POST /api/complete` can also directly finish an order with `{ "recordId": "...", "lockId": "...", "assignee": "...", "videoUrl": "https://..." , "directComplete": true }`.
- `POST /api/complete-status` with `{ "jobId": "..." }`; returns `processing`, `completed`, or `failed`.
- `POST /api/omni/complete` with `{ "recordId": "...", "lockId": "...", "assignee": "...", "flowShareUrl": "https://labs.google/fx/tools/flow/shared/video/..." }`; queues Flow extraction and R2 archival without watermark removal.
- `POST /api/omni/complete-status` with `{ "jobId": "..." }`; the order becomes complete only after the R2 public URL is readable and written back to Feishu.
- `POST /api/omni/claim-batch` with `{ "assignee": "name", "count": 5 }`; claims 1–10 Omni orders under the shared claim mutex and returns any safe partial result.
- `POST /api/omni/recover` with `{ "assignee": "name", "orders": [{ "recordId": "...", "lockId": "..." }] }`; validates locally saved locks and restores active or completed cards.
- `POST /api/omni/release-batch` with the same assignee and order-lock list; releases only owned, in-progress orders without active transfer jobs.
- `POST /api/complete` also accepts `"testMode": true`, which skips the watermark API and writes `MAILAB_TEST_VIDEO_URL` back to Feishu for URL-field testing.
- `POST /api/release` with `{ "recordId": "...", "lockId": "...", "reason": "..." }`
- `GET /api/image-proxy?url=...`

## Production platforms

The Feishu table needs a single-select field named `制作平台` with the options `豆包` and `Omni`.

- The Doubao extension sends `platform: "豆包"` when claiming.
- The Omni extension sends `platform: "Omni"` when claiming.
- Releasing or rolling back an order clears the platform so the shared task can be claimed again.
- Completed orders retain the platform value for reporting.

## Omni completion

The Omni extension accepts only a public single-video Flow share URL. The server derives Google's MP4 preview endpoint, downloads the video, uploads it to the existing R2 archive, verifies the public R2 URL, then writes that URL to `视频地址` and marks the order complete. The original Flow share URL is stored in `去水印原始链接`.

The batch web workbench can hold at most ten active locks. It prevents duplicate Flow video IDs in the current process, and every recovery, completion, and release request re-validates the Feishu record lock. `去水印原始链接` is written using Feishu's hyperlink object shape while the plain-text `视频地址` field remains a string.

If extraction, upload, or public verification fails, the job reports `failed` but the Feishu order remains `接单中`. The original assignee can retry with the same or a corrected share URL, or release the order manually.

## Optional Video Archive

Set `OSS_ARCHIVE_ENABLED=true` to archive completed videos to Cloudflare R2 after the order is already marked complete in Feishu.

This archive is intentionally asynchronous:

- Feishu still receives the original video URL immediately.
- The plugin does not wait for R2/OSS upload. Upload jobs run quietly in the backend.
- The backend starts downloading the temporary video URL as soon as the archive job is queued, then uploads the local temp file to R2. This reduces failures caused by short-lived source URLs expiring while waiting in the upload queue.
- Local temp video pressure is capped by `OSS_ARCHIVE_MAX_PREPARED_FILES`; the default `20` means at most 20 videos are downloading, waiting locally, or uploading at the same time.
- Archive uploads are queued and limited by `OSS_ARCHIVE_CONCURRENCY`; the default `1` is safest for small servers.
- Temporary download/upload network failures retry immediately in the same archive job with `OSS_ARCHIVE_RETRY_COUNT` and `OSS_ARCHIVE_RETRY_DELAY_MS`.
- R2 public URLs are verified before Feishu write-back with `OSS_ARCHIVE_PUBLIC_VERIFY_ATTEMPTS` and `OSS_ARCHIVE_PUBLIC_VERIFY_DELAY_MS`.
- Archive success appends the R2 public URL to the order log.
- Archive failure writes `最后错误` and appends a log line, but does not roll back the order.
- To roll back the feature, set `OSS_ARCHIVE_ENABLED=false` and restart the server.
- If `OSS_ARCHIVE_WRITE_BACK=true`, archive success also replaces the Feishu video field with the R2 public URL.
- Existing completed rows that still have temporary video links can be re-queued with `/api/archive-retry`.

Required server-side values:

```text
OSS_ARCHIVE_ENABLED=true
OSS_ARCHIVE_WRITE_BACK=true
OSS_ARCHIVE_CONCURRENCY=1
OSS_ARCHIVE_RETRY_COUNT=3
OSS_ARCHIVE_RETRY_DELAY_MS=5000
OSS_ARCHIVE_PUBLIC_VERIFY_ATTEMPTS=8
OSS_ARCHIVE_PUBLIC_VERIFY_DELAY_MS=5000
OSS_ARCHIVE_MAX_PREPARED_FILES=20
OSS_PROVIDER=wrangler-r2
R2_BUCKET=YOUR_BUCKET_NAME
R2_PUBLIC_BASE_URL=https://your-r2-public-domain.example.com
R2_PREFIX=mailab/videos
CLOUDFLARE_WRANGLER_BIN=wrangler
CLOUDFLARE_API_TOKEN=YOUR_CLOUDFLARE_API_TOKEN
MAILAB_ADMIN_KEY=CHANGE_THIS_TO_A_LONG_RANDOM_KEY
```

Retry historical completed records that still contain temporary links:

```bash
curl -X POST https://genvideo.mailab.top/api/archive-retry \
  -H 'content-type: application/json' \
  -d '{"adminKey":"CHANGE_THIS_TO_A_LONG_RANDOM_KEY","limit":50}'
```

Preview without queueing:

```bash
curl -X POST https://genvideo.mailab.top/api/archive-retry \
  -H 'content-type: application/json' \
  -d '{"adminKey":"CHANGE_THIS_TO_A_LONG_RANDOM_KEY","limit":20,"dryRun":true}'
```

The backend uses Wrangler CLI:

```bash
wrangler r2 object put <bucket>/<key> --file <temp-video-file> --content-type video/mp4 --remote
```

`R2_PUBLIC_BASE_URL` must be the root of a public R2 custom domain or public `r2.dev` URL. Users never receive R2 write credentials.

Good:

```text
R2_PUBLIC_BASE_URL=https://pub-xxxxx.r2.dev
R2_PREFIX=mailab/videos
```

Do not include the bucket name or object prefix in `R2_PUBLIC_BASE_URL`:

```text
R2_PUBLIC_BASE_URL=https://pub-xxxxx.r2.dev/mailab/videos
R2_PUBLIC_BASE_URL=https://pub-xxxxx.r2.dev/YOUR_BUCKET_NAME
```

After upload, the backend verifies the generated public URL before writing it back to Feishu. If the URL returns `404 Object not found` or `not publicly accessible`, enable R2 Public Access for the bucket/domain and check that `R2_PUBLIC_BASE_URL` points to the same bucket used by `R2_BUCKET`.

If the server logs `spawn wrangler ENOENT`, the PM2 process cannot find Wrangler. Install it and configure an absolute path:

```bash
npm install -g wrangler
which wrangler
```

Then set the result in `.env`, for example:

```text
CLOUDFLARE_WRANGLER_BIN=/usr/local/bin/wrangler
```

Restart after changing `.env`:

```bash
pm2 restart mailab-order-server
```

## Watermark Provider

Set `WATERMARK_PROVIDER` in `.env`:

- `zhuceka`: use `https://api.zhuceka.cn/home/api` and read `data.video` from the response. Requires `ZHUCEKA_UID` and `ZHUCEKA_KEY`.
- `doubao`: use the original Doubao API.
- `qsy`: use the configured QSY mini-program compatible API. Requires `QSY_BASE_URL`, `QSY_OPENID`, `QSY_REFERER`, and `QSY_USER_AGENT`. Use only when you have authorization to call that service.
