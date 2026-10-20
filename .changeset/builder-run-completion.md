---
"@agent-native/core": patch
---

`sendFusionBranchMessage` reports `completed` only after the app agent's run finishes, and `unconfirmed` when a dispatched run timed out or was cut off, so callers can tell an unfinished Builder run from a done one.
