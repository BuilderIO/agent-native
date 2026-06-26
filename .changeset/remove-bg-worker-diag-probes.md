---
"@agent-native/core": patch
---

Remove the temporary durable-background-worker hang-localizer diagnostics from the agent chat setup hot path. The analytics worker-stall bug they were added to debug is fixed and verified in prod, so the ~7 extra awaited DB round-trips per durable run setup (and their 8s-hang risk under DB stress) are no longer needed. The lasting fix and observability — the `worker_stage` column, cheap fire-and-forget `workerStep` markers, `readBackgroundRunClaim`, and the centralized request-context resolution — are retained.
