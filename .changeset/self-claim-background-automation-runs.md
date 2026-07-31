---
"@agent-native/core": patch
---

Stop scheduled jobs and event automations from being killed mid-run as
"background_worker_never_started". `runBackgroundAutomation` (shared by
`jobs/scheduler.ts` and `triggers/dispatcher.ts`) executes entirely
in-process — there is no HTTP self-dispatch — but still marked its run row
`dispatch_mode = 'background'` for the wider stale window, without ever
calling `claimBackgroundRun` the way a genuine HTTP background worker does.
That left the row parked at the transient `'background'` state for the run's
entire life, indistinguishable from a lost HTTP handoff: the unclaimed-
background-run sweep reaps any such row past its 25s grace window, so a
single tool call running past 25s (routine for a report or analytics job)
got the still-executing run errored out from under it, discarding whatever
it later completed with.

The runner now self-claims its row into `'background-processing'`
immediately after inserting it — the same claimed state a real HTTP worker
reaches — which removes it from the unclaimed-sweep's eligibility (it filters
on `dispatch_mode = 'background'` exactly) and puts it under the wider,
heartbeat-driven stale window instead, with the correct `stale_run` code if
it ever genuinely dies.
