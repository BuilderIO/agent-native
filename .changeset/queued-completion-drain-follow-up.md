---
"@agent-native/core": patch
---

Queued messages wait for a busy thread to go idle and are promoted then, instead of waiting for the next recurring sweep. If the thread stays busy for 10 minutes, the message is left to the sweep and the server logs an error.
