---
"@agent-native/core": patch
---

Durable background agent-chat: extend the foreground claim-grace adaptively for
slow-but-alive workers. The foreground waits a fixed grace for the background
worker to claim a dispatched run, then recovers inline. Heavy apps (e.g.
analytics) can take longer than that grace to build the system prompt and load
actions before reaching `claimBackgroundRun`, so their worker lost the race every
time and the 15-minute background budget went unused (observed in prod as the run
stalling at `auth_passed`, then recovering via `foreground_inline_recovery`).

The circuit-breaker now extends the grace to a longer cap ONLY while the worker
has proven it is alive and still in setup — it recorded `auth_passed` /
`worker_entered` but has not claimed yet — so a live-but-slow cold start is
honored instead of abandoned mid-setup. A dead handoff never records those
stages, so it still recovers inline at the base grace; and a worker that recorded
a pre-claim failure (`route_threw` / `worker_threw` / `auth_failed`) recovers
inline immediately instead of waiting out the grace. The claim itself still
happens right before the agent loop starts, so all existing fast-recovery and
duplicate-delivery guarantees are preserved.
