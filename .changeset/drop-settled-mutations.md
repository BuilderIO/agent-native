---
"@agent-native/core": patch
---

Drop settled mutations from the query cache as soon as no hook observes them, so they no longer keep a render's data alive for five minutes.
