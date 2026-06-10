---
"@agent-native/core": patch
---

Collapse duplicate SSE+poll loops: extract shared SyncTransport so each tab opens one connection regardless of how many hooks subscribe.
