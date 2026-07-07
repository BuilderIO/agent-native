---
"@agent-native/core": patch
---

`useDbSync` batches consisting entirely of suppressed action events (via `suppressActionInvalidationFor`) now skip the fixed framework invalidation list (extension, slot, tool, and app-state keys) as well as the whole-action-cache invalidation — high-volume background mutations no longer refetch framework queries on every poll tick. Events are still forwarded to `onEvent` and per-source change versions still bump.
