---
"@agent-native/core": patch
---

Keep serverless startup bounded by moving legacy chat-thread repair, global stale-run cleanup, and remote MCP connection setup out of route initialization, and batch additive Postgres schema introspection into one query.
