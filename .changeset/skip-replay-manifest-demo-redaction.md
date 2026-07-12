---
"@agent-native/core": patch
---

Also skip demo-mode number redaction on session replay manifest requests, alongside the existing chunk/event payload skip, so replay geometry and pointer data can never be faked at view time.
