---
"@agent-native/core": patch
---

Local development, tests and self-hosted servers now record framework store migrations in the `_an_store_migrations` ledger, so each migration runs once per database instead of on every process start. Hosted requests still never write the ledger.
