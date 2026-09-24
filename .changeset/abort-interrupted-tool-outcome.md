---
"@agent-native/core": patch
---

Record a tool call interrupted by a run abort as an interrupted (unknown) outcome instead of a failure, so a resumed chunk goes through the ledger recovery and interruption budget rather than re-dispatching a write that may already have happened.
