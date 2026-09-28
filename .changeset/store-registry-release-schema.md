---
"@agent-native/core": patch
---

Framework stores now declare their schema with `defineStore()`. The release step applies each store's migrations once per database and records them in `_an_store_migrations`; hosted request runtimes verify that ledger with one query per process instead of probing, backfilling, and altering tables on every cold start, and fail with `SchemaNotMigratedError` when a release did not run. `getDbExec()` now always returns the schema-guarded client.
