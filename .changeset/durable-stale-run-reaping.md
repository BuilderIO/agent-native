---
"@agent-native/core": patch
---

Fix stale agent runs never being reaped in production. The periodic stale reaper
lived on an in-process timer that `shouldDisableInProcessSweeps()` turns off for
every production serverless function, and nothing durable replaced it, so a run
whose producer died stayed "running" until an unrelated request path happened to
notice. Stale reaping now rides the signed, platform-scheduled recurring-job
sweep — one site-wide reap per tick instead of one per warm container.

Also corrects what the reapers record: `completed_at` is now the run's last
liveness basis rather than the time a reaper noticed, so a reaped run reports its
real duration instead of detection latency; and `terminal_reason` is the
normalized `error:stale_run` that the event reconciler already writes for the
same outcome, so one failure no longer splits across two permanent
`agent_run_outcome_daily` buckets. Heartbeat writes are bounded to one attempt
inside a third of the stale window, so a live run can no longer be reaped while
its own heartbeat is still in flight holding a pooler connection.
