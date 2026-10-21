---
"@agent-native/core": patch
---

Keep the bounded-task esbuild helper out of runtime collaboration imports.
Import `bundleBoundedTaskSource` from `@agent-native/core/collab/bounded-task-bundle`
instead of `@agent-native/core/collab`.
