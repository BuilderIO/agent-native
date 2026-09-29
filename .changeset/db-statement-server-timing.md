---
"@agent-native/core": patch
---

Report `db-queries` and `db-connects` in Server-Timing alongside `db-ops`, so a request's SQL statement count can be read without counting pool connects as statements.
