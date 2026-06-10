---
"@agent-native/core": patch
---

Fix db.transaction(async …) throwing on the default local-SQLite (better-sqlite3) database by replacing the sync-only native wrapper with a manual BEGIN IMMEDIATE / COMMIT / ROLLBACK path; nested async calls use SAVEPOINTs.
