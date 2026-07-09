---
"@agent-native/core": patch
---

Replay the real terminal error for completed agent runs on reconnect instead of replacing provider failures with stale-run messages, and stop heartbeat updates after a run leaves the running state.
