---
"@agent-native/core": patch
---

Diagnostic-only: in the background-agent worker, emit a `presend:<settled-set>`
breadcrumb as each parallel pre-send promise settles, so a worker that freezes
between `env_config` and `context_all` reveals the exact hanging step (system
prompt, view-screen, app-state reads, etc.) via the name missing from the last
breadcrumb. No behavior change.
