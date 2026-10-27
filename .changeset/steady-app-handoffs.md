---
"@agent-native/core": patch
"@agent-native/dispatch": patch
---

Preserve app-only visibility when Dispatch overrides the built-in embed helper so Workspace app sessions reach their iframe without exposing the one-time ticket to the model.
