---
"@agent-native/core": patch
---

A chat started on a create route keeps its new-thread state after the route adopts the thread id on submit. Previously the chat fell into a restore-loading state until the thread list loaded, which hid the thinking indicator.
