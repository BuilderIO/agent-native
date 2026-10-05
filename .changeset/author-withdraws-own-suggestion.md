---
"@agent-native/core": patch
---

Let a suggestion's author withdraw their own pending suggestion with comment access through `decide-resource-suggestion` (`decision: "withdrawn"`). A withdrawn suggestion gets the new `withdrawn` status, so it stays distinct from a reviewer's rejection. Accepting and rejecting still require edit access, and adapters' `coordinateDecision` now runs only for acceptance.
