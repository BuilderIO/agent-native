---
"@agent-native/core": patch
---

The actions skill in new apps now tells agents that a call must mean the same with padded `null`, `[]` and `false` fields as without them, so an optional switch acts only when `true`. The `emptyListsEraseNothing` option's docs say the same for empty lists.
