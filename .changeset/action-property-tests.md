---
"@agent-native/core": patch
---

Add `checkActionProperties` at `@agent-native/core/action-properties`, which generates inputs from an action's zod schema and checks its return values, errors, and input validation. `fast-check` is an optional peer dependency for it.
