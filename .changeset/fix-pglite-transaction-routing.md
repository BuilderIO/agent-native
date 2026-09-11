---
"@agent-native/core": patch
---

Keep transaction-scoped framework and app database reads on the active local PGlite transaction so review actions cannot stall the database.
