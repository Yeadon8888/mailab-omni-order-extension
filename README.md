# MAILAB Omni Order

Private source repository for the MAILAB shared Feishu order workflow.

## Packages

- `extension-omni/` — Chrome MV3 extension injected only into Google Flow. It claims one order at a time, copies the prompt/reference image, accepts a manual Flow single-video share URL, polls R2 archival, and completes the Feishu order after verification.
- `extension-doubao/` — existing Doubao/Dola extension upgraded to record `制作平台 = 豆包` when claiming.
- `web-omni/` — standalone batch production desk for claiming up to ten Omni orders, binding Flow links, restoring locks, and monitoring independent R2 write-backs.
- `server/` — Node backend for Feishu locking, platform tracking, Flow extraction, R2 upload/verification, and completion callbacks.

## Core guarantees

- Omni never listens for or auto-selects generated videos; users manually paste a `labs.google/fx/tools/flow/shared/video/...` URL.
- The legacy Omni extension holds one order; the web workbench safely holds up to ten active Omni orders.
- R2 must be readable before `任务状态` changes to `已完成`.
- Omni transfer failures keep the task assigned and retryable.
- Releasing a task clears its `制作平台`; successful completion retains it.

## Verification

```bash
npm test --prefix server
node --check extension-omni/background.js
node --check extension-omni/content.js
node --check extension-doubao/background.js
node --check extension-doubao/content.js
```
