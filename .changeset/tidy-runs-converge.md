---
"@agent-native/core": patch
---

Fix a server hang caused by run reconciliation never reaching a fixed point. A run row already holding its reconciled terminal values still matched the repair UPDATE, and an unchanged rewrite counts as an affected row, so `reconcileTerminalRunFromEvents` reported a repair on every call. `getRunByThread` re-reconciles whenever a repair is reported, so a single settled `errored`/`stale_run` row made every lookup for that thread recurse without terminating, pinning the event loop and hanging all requests.
