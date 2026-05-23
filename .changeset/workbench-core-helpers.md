---
"@agent-native/core": patch
---

Re-export `deleteOrHideExtension` and `hideExtensionForCurrentUser` from `@agent-native/core/client/extensions` so templates that wrap the extensions system (e.g. Workbench Custom Tools) don't have to deep-import internals. Also add CLI templates-meta entry for the new hidden `workbench` template.
