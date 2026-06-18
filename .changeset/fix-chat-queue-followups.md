---
"@agent-native/core": patch
---

Fix active chat follow-up queueing so ordinary sends during a running turn stay queued, keep the thinking indicator attached to the active response, retry any fresh user turn — queued follow-ups and normal sends fired shortly after the previous run finished — through transient 409 active-run conflicts instead of reconnecting to the prior run (which replayed its answer, dropped the new message, and corrupted thread history), while still letting genuine internal continuations resume the active run, and stabilize built-in data widget renderers to avoid chart remount loops.
