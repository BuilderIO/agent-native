---
"@agent-native/core": patch
---

Stop refusing agent tool calls that pair a `null` placeholder with unused `false` booleans, which made Analytics dashboard reads fail with an unclear "ambiguous placeholders" error.
