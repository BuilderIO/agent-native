---
"@agent-native/core": patch
---

`useDbSync` no longer re-polls and invalidates every query on each repeated `SYNC_EVENT_READ_UNAVAILABLE` response. Only the first one of an outage resyncs; repeats take the backed-off failure path, and the next successful poll recovers.
