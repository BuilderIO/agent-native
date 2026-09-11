---
"@agent-native/core": patch
---

Share the database exec singleton across Vite dev module runners so PGlite migrations cannot deadlock. Register Drizzle-opened PGlite transactions with the shared exec so queries inside them (e.g. `getDbExec()` calls made from a `getDb().transaction(...)` callback) no longer deadlock against the main PGlite connection.
