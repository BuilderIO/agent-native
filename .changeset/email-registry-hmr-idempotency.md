---
"@agent-native/core": patch
---

Allow transactional email definitions to re-register after a development hot reload while still rejecting conflicting catalog metadata for the same id. Add atomic batch registration so a conflicting catalog cannot leave partial entries behind.
