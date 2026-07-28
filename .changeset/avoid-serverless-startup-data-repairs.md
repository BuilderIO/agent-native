---
"@agent-native/core": patch
---

Keep serverless startup bounded by moving the legacy chat-thread message-count repair and global stale-run cleanup out of route initialization, and batch additive Postgres schema introspection into one query.
