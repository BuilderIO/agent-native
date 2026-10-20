---
"@agent-native/core": patch
---

`create-resource-suggestion-proposal` accepts `supersedes`, like `create-resource-suggestion`: the author's own earlier pending suggestions on the same resource become `superseded` in the same step that creates the proposal. A single call can now supersede up to 100 suggestions.
