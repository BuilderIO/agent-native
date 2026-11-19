---
"@agent-native/core": minor
---

Add `userTurn: "direct"` for actions that write on the user's own behalf. Over MCP the call needs an admitted user-turn grant, then runs immediately when the action's per-call `needsApproval` predicate returns exactly `false`; any other answer, including a throw, sends it to the app's review page. Existing `read` and `approval` actions behave as before.
