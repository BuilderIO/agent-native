---
"@agent-native/core": patch
---

Allow transactional email definitions to re-register after a development hot reload while still rejecting conflicting catalog metadata for the same id. Add atomic batch and scoped snapshot registration so conflicting or deleted catalog entries cannot leave partial or stale definitions behind.
