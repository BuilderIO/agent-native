---
"@agent-native/core": patch
---

Run tool calls that pair unused `null` optional fields with a chosen `false`. A valid `false` no longer counts as an ambiguous clear, so the nulls are stripped instead of the whole call being refused.
