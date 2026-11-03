---
"@agent-native/core": minor
"@agent-native/toolkit": minor
---

Two writers changing one record no longer silently overwrite each other. Core adds `saveIfCurrent` in `@agent-native/core/save-conflict/server`, which writes only when the record still has the revision the caller read and otherwise throws a typed `save_conflict` carrying the current value, and `saveWithMerge` in `@agent-native/core/save-conflict`, which merges and saves again before asking anyone. Toolkit adds `useSaveConflictPrompt` in `@agent-native/toolkit/app/save-conflict`, the one prompt for when both writers changed the same field. Forms, Clips and Mail use them first.
