---
"@agent-native/core": patch
---

fix(agent): make the durable background-function worker reliably claim its run for heavy apps (analytics). Two changes: (1) the per-run context now carries `isBackgroundWorker`, set before the system prompt is built, so template `extraContext`/prompt builders can skip heavy, hang-prone enrichment in the worker — the analytics data-dictionary read+render (which ran eagerly during prompt construction, before any pre-send timeout could arm) is now skipped in the worker, while the foreground keeps the full dictionary; (2) the pre-send context cap now takes thunks instead of eagerly-created promises, so each step runs inside an already-armed timeout (an eager promise could start and stall the event loop before the cap wrapped it) and a stalled step is recorded as `presend_timeout:<label>` for attribution. Foreground behavior is unchanged.
