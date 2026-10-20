---
"@agent-native/core": patch
---

Keep the bounded-task compiler out of the collaboration runtime dependency graph so serverless functions do not carry esbuild and its native binary. Build-time callers should import `bundleBoundedTaskSource` from `@agent-native/core/collab/build` instead of `@agent-native/core/collab`. The `?bounded-task` build plugin and runtime worker APIs are unchanged.
