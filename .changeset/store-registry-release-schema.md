---
"@agent-native/core": patch
---

Framework stores now declare their schema with `defineStore()`. The release step applies each store's migrations once per database and records them in `_an_store_migrations`. Hosted functions of apps that migrate at release verify that ledger with one query per process instead of probing, backfilling and altering tables on every cold start, and fail with `SchemaNotMigratedError` when the release did not run (betas that borrow production's schema warn instead). Apps that do not migrate at release keep provisioning on demand and never write the ledger. `getDbExec()` now always returns the schema-guarded client.
