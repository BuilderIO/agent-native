---
"@agent-native/core": patch
---

Scheduled integration recovery now dispatches recovered work to the deployment's own URL. Previously every recovery dispatch went to `localhost:3000` and failed, because the scheduled request carries no Host header. Recovery also no longer re-runs pending integration tasks created more than 24 hours ago. It leaves those rows as they are rather than answering long-stale messages.
