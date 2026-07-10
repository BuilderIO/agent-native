---
"@agent-native/core": patch
---

Fix a false `stale_run` failure for background runs holding a long tool call or A2A `call-agent` delegation: the stale-run reaper now grants a bounded grace to a run whose in-flight work is provably still open, even when its heartbeat write itself failed, instead of killing it on a single missed heartbeat window. A genuinely dead run with stuck in-flight work is still failed loudly once the bounded grace elapses. `/runs/active` also now surfaces this signal as `hasInFlightWork` so clients can tell a run with live work apart from one that is truly stuck.
