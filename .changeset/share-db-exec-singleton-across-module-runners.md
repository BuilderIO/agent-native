---
"@agent-native/core": patch
---

Register Drizzle-opened PGlite transactions with the shared exec so queries made through getDbExec() inside a getDb().transaction() callback no longer deadlock against the main PGlite connection.
