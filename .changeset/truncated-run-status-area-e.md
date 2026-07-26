---
"@agent-native/core": patch
---

Give `agent_runs.status` a value that means "truncated" so a run cut off at a budget, timeout, loop-limit, or no-progress boundary is no longer filed as `completed`. Truncations outnumbered genuine completions on some apps while being invisible to every success-rate query, and because retention keys off status they were deleted after a day while real errors survived a week — the most-reported failures were also the fastest to lose their evidence. `terminalStatusForEvent` now returns `completed` if and only if the terminal reason is `done`; `setRunTerminalReason` corrects a `completed` row to `truncated` for every writer that sets status before it knows the reason; and `cleanupOldRuns` / `listErroredRuns` treat truncations as the failures they are. Additive: `status` is plain TEXT, so no migration is needed.
