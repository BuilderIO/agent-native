---
"@agent-native/core": patch
---

A session navigation's stall timer no longer throws when it fires after `window` is gone, as it can in a test environment that has been torn down.
