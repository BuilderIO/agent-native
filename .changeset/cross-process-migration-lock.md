---
"@agent-native/core": patch
---

Serialize framework release migrations across processes with a Postgres advisory lock, so workspace apps sharing a database can run `migrate:production` concurrently instead of one at a time.
