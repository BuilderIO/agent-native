---
"@agent-native/core": patch
---

Queued messages are promoted when a run finishes even if the thread is still settling then, instead of waiting for the next recurring sweep.
