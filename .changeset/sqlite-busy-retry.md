---
"@agent-native/core": patch
---

`configureLocalSqlite` now retries the `journal_mode = WAL` pragma on SQLITE_BUSY instead of throwing straight out of auth bootstrap, so Better Auth's own SQLite connection survives a concurrent write lock from the shared app connection's first-boot migration burst the same way the shared connection already does.
