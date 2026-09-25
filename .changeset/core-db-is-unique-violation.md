---
"@agent-native/core": patch
---

Export `isUniqueViolation` from `@agent-native/core/db`. Apps that let a
partial unique index arbitrate a race — two schedulers allocating the same
sequence number, say — otherwise have to re-implement the Postgres/SQLite
error sniffing that `db/client.ts` already does.
