---
"@agent-native/core": patch
---

Better Auth's framework migrations now belong to a store recorded in `_an_store_migrations`, so the release step runs a single migration runner. The signing-key expiry migration runs at most once per database; existing databases import their Better Auth history instead of re-running it.
