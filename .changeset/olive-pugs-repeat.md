---
"@agent-native/core": patch
---

Build the `LOWER(...)` expression indexes without `CONCURRENTLY`.

The release schema step runs over the pooled Neon endpoint, and a
transaction-pooled connection cannot carry `CREATE INDEX CONCURRENTLY` to
completion. The statement returned without creating the index, the verifying
probe then failed the whole release, and every docs production deploy was
blocked. Plain `CREATE INDEX` is the form that actually lands here.
