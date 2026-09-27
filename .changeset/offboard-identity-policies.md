---
"@agent-native/core": patch
"@agent-native/dispatch": patch
---

Fix member offboarding and email-change rekey on migrated app databases. Apps declare their own identity columns with `registerIdentityColumns()` from `@agent-native/core/org`, share tables made by `createSharesTable()` are recognized by shape, Better Auth sessions keyed by `user_id` are revoked, and org member routes log the underlying failure instead of discarding it.
