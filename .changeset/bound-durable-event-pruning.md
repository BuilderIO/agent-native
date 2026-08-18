---
"@agent-native/core": patch
---

Bound durable-event pruning to one atomic Postgres statement so interrupted serverless workers cannot leave idle transactions behind.
