---
"@agent-native/core": patch
---

Keep serverless startup bounded by moving the legacy chat-thread message-count repair out of process initialization and batching additive Postgres schema introspection into one query.
