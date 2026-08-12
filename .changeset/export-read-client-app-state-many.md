---
"@agent-native/core": patch
---

Export `readClientAppStateMany` (and its `ClientAppStateBatch` return type) from `@agent-native/core/client/hooks`, alongside its sibling application-state helpers, so the documented batched-read import actually resolves.
