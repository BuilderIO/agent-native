---
"@agent-native/core": patch
---

Emit an `agent_run_terminal` analytics event for every terminal agent run
(completed, errored, aborted, or truncated at a continuation boundary),
reusing the same best-effort `track()` seam that already carries
`$ai_generation` into `analytics_events`. Run cutoffs — budget exhaustion,
loop limits, aborts, and the `truncated` continuation status — were
previously visible only in each app's operational `agent_runs` table and
absent from analytics entirely. The event carries `run_id`, `thread_id`,
`turn_id`, `status`, `terminal_reason`, `error_code`, `error_detail`,
`dispatch_mode`, `abort_reason`, and `duration_ms`; `model`/`engine`/
`attempt_count` are forwarded through the new optional `StartRunOptions`
fields, now populated by every built-in `startRun` caller (main chat,
agent teams, harness runs, integration webhooks, the Google Docs poller,
and recurring jobs) with the resolved model actually sent to the engine —
never the raw client-requested one. `userId` is left unset everywhere: no
caller in this codebase has an opaque (non-email) user id available at its
`startRun` call site. Emission fires only after the run's terminal status
and thread_data are durably persisted, and a missing or failing tracking
provider can never affect the run.
