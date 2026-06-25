---
"@agent-native/core": patch
---

Durable background agent-chat: wait adaptively for a slow-but-alive worker to
claim a dispatched run, instead of abandoning it and recovering inline. The
foreground waits a base grace for the background worker to claim; heavy apps
(e.g. analytics) can take longer than that to build the system prompt and load
actions before claiming, so their worker lost the race every time and the
15-minute background budget went unused (observed in prod: the run stalls at
`auth_passed`, then recovers via `foreground_inline_recovery`).

The circuit-breaker now keeps polling past the base grace ONLY while the worker
is provably alive and still in setup — its `diag_stage` (parsed from the stored
JSON payload) is `auth_passed`/`worker_entered` but it has not claimed yet. A
dead handoff never records those stages, so it still recovers inline at the base
grace; a worker that recorded a pre-claim failure (`route_threw` / `worker_threw`
/ `auth_failed`) recovers inline immediately. The extension is bounded by the
unclaimed-run reaper's own window, measured from the run's liveness
(`COALESCE(heartbeat_at, started_at)`), so the foreground always claims the run
inline just before `reapUnclaimedBackgroundRun` could fire — immune to dispatch
latency between insert and the start of polling. The claim itself still happens
right before the agent loop, so all existing fast-recovery and duplicate-delivery
guarantees are preserved.
