---
"@agent-native/core": patch
---

Fix the lazy DB proxy masquerading as a resolved SQL entity when an un-awaited query chain is embedded as a raw value (it now throws a clear error instead of recursing into `RangeError: Maximum call stack size exceeded`), and stop every local SQLite consumer (`getDbExec()`, and each `createGetDb()` schema store) from opening its own `better-sqlite3` connection to the same file, which caused cross-connection "database is locked" contention under ordinary concurrent writes.
