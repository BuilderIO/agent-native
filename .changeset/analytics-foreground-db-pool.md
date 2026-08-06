---
"@agent-native/core": patch
---

Reduce serverless foreground database pools to leave connection headroom for warm user-facing instances while preserving the larger pool for durable workers.
