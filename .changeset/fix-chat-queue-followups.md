---
"@agent-native/core": patch
---

Fix active chat follow-up queueing so ordinary sends during a running turn stay queued, keep the thinking indicator attached to the active response, and stabilize built-in data widget renderers to avoid chart remount loops.
