---
"@agent-native/core": patch
---

Make app-secret writes an atomic upsert and org membership acceptance idempotent (unique org member index + conflict-safe insert).
