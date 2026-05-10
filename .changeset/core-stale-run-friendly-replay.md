---
"@agent-native/core": patch
---

fix(agent): SSE reconnects to a run that's marked `errored` in SQL but has no terminal event in the event stream now replay the same friendly stale-run message reapers send (`"The agent stopped before it could finish…"`) instead of a bare `run_terminal_event_missing` debug string. The terminal event is also persisted idempotently via the new `ensureTerminalRunEvent` helper, so future reconnects replay it from SQL on the normal path rather than regenerating it.
