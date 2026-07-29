---
"@agent-native/core": patch
---

Keep a failed or stopped run visible on the turn it belongs to. The assistant
turn now carries a collapsed inline marker built from the persisted run-error
metadata (with the run duration when known), so the failure survives the next
prompt instead of only existing in the transient recovery banner. The banner
still owns the run it is showing, so the same failure is never announced twice.
