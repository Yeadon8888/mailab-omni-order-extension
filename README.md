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
