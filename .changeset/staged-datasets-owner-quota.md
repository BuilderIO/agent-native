---
"@agent-native/core": patch
---

Staged datasets now have a per-user quota (50 MB and 200,000 rows per app), so one user's writes evict only their own older datasets. A 500 MB, 2 million row app-wide backstop is the only limit that can evict other users' data. Every write removes datasets that have gone 14 days without an update, and querying a removed dataset fails with `staged_dataset_removed` instead of "not found".
