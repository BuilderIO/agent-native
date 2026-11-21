---
"@agent-native/core": patch
---

Soft delete support: `registerShareableResource` takes `deletedAtColumn`, so stamped rows drop out of `accessFilter` and read as no access in `resolveAccess`/`assertAccess` unless the caller passes `includeDeleted`, and new apps ship a `soft-delete` skill describing the stamp, restore, and purge pattern.
