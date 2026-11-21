---
"@agent-native/core": patch
---

Allow a later web request after a pre-dispatch rejection while keeping dispatched write failures guarded. Warn when the outcome is unknown in completed no-work background automations without exposing unknown provider results.
