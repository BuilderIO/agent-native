---
"@agent-native/core": patch
---

`update-resource-suggestion` takes an optional `baseRevision`: the resource revision the amendment's operations were written against. The adapter validates it as it does a new suggestion's, and the suggestion moves onto it, so an author can keep amending a suggestion after the resource changed elsewhere. An amendment's operations must target what the suggestion already targets.
