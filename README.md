# MAILAB Omni Order

Private source repository for the MAILAB shared Feishu order workflow.

## Packages

- `extension-omni/` — Chrome MV3 extension injected only into Google Flow. It holds up to ten Omni orders, feeds each image/prompt into Omni Flash, maps each generated result back to its lock, captures the public share URL, polls R2 archival, and completes Feishu after verification. Manual share-link fallback is retained.
- `extension-doubao/` — existing Doubao/Dola extension upgraded to record `制作平台 = 豆包` when claiming.
- `web-omni/` — standalone batch production desk for claiming up to ten Omni orders, binding Flow links, restoring locks, and monitoring independent R2 write-backs.
- `server/` — Node backend for Feishu locking, platform tracking, Flow extraction, R2 upload/verification, and completion callbacks.

## Core guarantees

- Omni forces `x1` before automatic submission so one Flow result maps to one Feishu lock.
- Image/prompt feeding is serialized, while the submitted Flow video jobs continue in parallel.
- Generated cards are mapped from the DOM node created by each submission, rather than selected by newest timestamp alone.
- A background result tab disables `Include inputs`, captures only `labs.google/fx/tools/flow/shared/video/...`, and then starts the existing R2/Feishu pipeline.
- The extension and web workbench each safely hold up to ten active Omni orders.
- R2 must be readable before `任务状态` changes to `已完成`.
- Omni transfer failures keep the task assigned and retryable.
- Releasing a task clears its `制作平台`; successful completion retains it.

## Verification

### Doubao resolver compatibility (2026-09-02)

- Submitted links remain restricted to public Doubao threads or supported Omni Flow shares. A share-page host is not necessarily the video CDN host.
- The local Doubao resolver accepts HTTPS video URLs on `doubao.com`, `douyin.com`, `douyinvod.com`, `bytecdn.cn`, and `byteimg.com`, including their actual subdomains (not lookalike suffixes). Credentials and nonstandard ports are rejected; the `lr=unwatermarked` requirement is retained.
- Within each quality tier it checks main/play/backup URLs before trying a lower quality. Unknown-domain errors record only hostnames, never signed URL paths or query strings.
- Both the order desk and standalone archive route use the same resolver/provider failover chain, including when the browser supplies `fallbackApi`. An unrecognized candidate is never passed directly to the downloader: providers independently resolve the original share link.
- Failed order transfers retain their lock and assignment. Completion still requires R2 verification and successful Feishu write-back.
- Historical logs did not include the rejected hostname. Do not assume a particular CDN caused those historical failures; the regression fixtures test compatibility and failover behavior, not captured historical payloads.

```bash
npm test --prefix server
node --test extension-omni/test/*.test.mjs
node --check extension-omni/background.js
node --check extension-omni/content.js
node --check extension-omni/flow-adapter.js
node --check extension-omni/page-hook.js
node --check extension-doubao/background.js
node --check extension-doubao/content.js
```

The extension end-to-end test uses an isolated Chrome profile and mocked Flow/backend pages. It covers batch claim, automatic feeding, generated-card mapping, share-link capture, R2 completion, and Feishu write-back without consuming real orders or Flow credits.
