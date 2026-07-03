---
"@agent-native/core": patch
---

Make durable agent run recovery quieter by idempotently handling retried run rows and waiting longer for server-owned background continuations.
