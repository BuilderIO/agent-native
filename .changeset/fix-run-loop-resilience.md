---
"@agent-native/core": patch
---

Fix four run-loop reliability bugs: widen RUN_STALE_MS to 15s to reduce false-positive stale reaps; self-abort displaced zombie runs and guard final status writes with a conditional WHERE so they cannot clobber a newer run's state; add per-run event persistence chaining so out-of-order SQL commits no longer silently gap the reconnect cursor; atomically gate double-run prevention with a SQL claim check instead of a racy read-then-act; emit 'clear' before resumable-error continuations to prevent duplicated partial text.
