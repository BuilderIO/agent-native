---
"@agent-native/core": patch
---

Fail A2A tasks whose processor died instead of leaving them reporting "working" forever.

Recovery for a stuck `a2a_tasks` row was reachable only from an inbound `tasks/get`, so it depended on the calling agent continuing to poll. When that agent's turn ended, nothing else ever looked: the task stayed `working`/`processing` indefinitely while its underlying `agent_runs` row was already reaped to `errored`. A new `reapAllStaleA2ATasks()` sweep rides the same signed recurring tick as the stale-run reaper and applies the same terminal verdicts without a poller, and both drivers now read one shared rule in `a2a/task-lifetime.ts` so their thresholds cannot drift.
