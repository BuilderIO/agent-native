---
"@agent-native/core": patch
---

Add diagnostic-only worker-side progressive setup-stage diagnostics
(`worker_setup_step`) to localize where a durable background worker hangs between
`auth_passed` and `claimBackgroundRun`. For the background worker only (gated on
`isBackgroundWorker`, using the marker's early-available runId), emit the last
setup stage reached — `db_request_ctx`, `env_config`, `context_all`,
`action_tool_setup`, `owner_thread`, `prestart` — as the run's `diag_stage`, so a
worker that stalls leaves a breadcrumb at the stage it stopped in. Best-effort and
fire-and-forget; no control-flow change.
