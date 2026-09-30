---
"@agent-native/core": patch
---

Scheduled integration recovery now dispatches recovered work to the deployment's own URL. Previously every recovery dispatch went to `localhost:3000` and failed, because the scheduled request carries no Host header. Integration tasks created more than 24 hours ago are no longer run, whether by recovery or as the next task in their thread, and they no longer hold up newer messages in that thread. Their rows are left as they are rather than answering long-stale messages.
