---
"@agent-native/core": patch
---

Framework stores now declare their schema with `defineStore()`. The release step applies each store's migrations once per database under a lease, records them in `_an_store_migrations`, and fails the deploy with `SchemaNotMigratedError` when the ledger does not cover the code it ships. Hosted functions of apps that migrate at release do no schema work on cold starts. Apps that do not migrate at release keep provisioning on demand and never write the ledger. `getDbExec()` now always returns the schema-guarded client.
