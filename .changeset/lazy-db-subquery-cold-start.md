---
"@agent-native/core": patch
---

Fix `getDb()` select subqueries (e.g. `inArray(col, db.select(...).from(t))`) throwing "unresolved query chain" on the first query after a cold start.
