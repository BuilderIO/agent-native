---
"@agent-native/core": patch
---

fix: avoid spurious failures in two edge cases.

- `agent_run_events` writes now use `ON CONFLICT (run_id, seq) DO NOTHING` so a `pendingTerminalEvent`-reserved seq getting reused, or `appendTerminalRunEvent` racing with the producer's final event, no longer leaves the run in an inconsistent terminal state.
- `fetchPollJson` in `use-db-sync` now awaits `res.json()` inside the `try` before the timeout `finally` runs, so a body-stream abort can't escape as an unhandled rejection.
