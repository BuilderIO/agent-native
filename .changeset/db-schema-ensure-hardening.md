---
"@agent-native/core": patch
---

Retry transient `lock_timeout` DDL failures with bounded backoff, fail loudly when a table with a framework table's name lacks its required columns, add `notified_at` to app-owned shares tables at release (plus `sharesTableMigrationSql` for app migrations), and add `configurePgliteExtensions` for registering PGlite extensions.
