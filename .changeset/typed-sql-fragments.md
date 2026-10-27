---
"@agent-native/core": patch
---

Add a typed PostgreSQL SQL fragment kernel for bound values, validated identifiers, and fragment composition. `getDbExec().execute()` accepts fragments, and a diff-scoped guard blocks new interpolated raw SQL templates.
