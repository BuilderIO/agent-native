---
"@agent-native/core": patch
---

`create-resource-suggestion` accepts `supersedes`: IDs of the caller's own earlier suggestions on the same resource. Pending ones become `superseded` in the same transaction as the new suggestion, with a recorded decision that points to the replacement. Suggestions that are already decided stay as they are.
