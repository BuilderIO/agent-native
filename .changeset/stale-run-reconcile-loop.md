---
"@agent-native/core": patch
---

Fix an unbounded reconciliation loop that could pin the server at 100% CPU and
stop it answering requests. A run parked at `errored`/`stale_run` re-derived its
own state from its own stale marker in the event ledger, so the repair UPDATE
matched, reported rows affected, and told callers a repair had happened — which
made them re-read the unchanged row and reconcile it again forever. A stale row
is now only superseded by a different terminal event.
