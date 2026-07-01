---
"@agent-native/core": patch
---

Don't reap a run that is actively making progress. The stale reapers
(`reapIfStale`, `reapAllStaleRuns`, and the heartbeat-stale path of
`cleanupOldRuns`) keyed liveness solely on `heartbeat_at` (the 1.5s
process-liveness timer) and ignored `last_progress_at` (bumped whenever the
agent emits an event, including a long-running tool's periodic activity
heartbeats — e.g. image generation streaming activity every 8s). When the
heartbeat write lagged while a multi-minute tool was in flight, the run was
flipped to `errored`, and the producing isolate's SQL-abort check then
self-aborted the in-flight tool with "Run aborted" — looping on the
durable-background self-chaining path and interrupting once inline. The reapers
now use the most recent of `heartbeat_at` and `last_progress_at` (falling back to
`started_at`) as their liveness basis, so a demonstrably-progressing run is never
reaped mid-tool. Portable across SQLite and Postgres; can only make reaping more
conservative (a dead producer emits neither signal).
