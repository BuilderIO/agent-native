---
"@agent-native/core": patch
---

Prevent timed Neon queries from leaking statement timeouts across pooled sessions and cancel background HTTP queries at their deadline.
