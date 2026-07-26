---
"@agent-native/core": patch
---

Make agent run outcomes measurable and stop dead workers from latching the in-flight reaper grace. Completed runs prune after a day while errored runs are kept for a week, so any wider window undercounted successes — `cleanupOldRuns` now folds each pruned run into an additive `agent_run_outcome_daily` counters table (read via `getRunOutcomeCounters`) so outcome rates survive pruning. The `in_flight_since` stale-reaper grace no longer applies to a run whose heartbeat and progress writes have both been dead longer than `IN_FLIGHT_GRACE_MAX_LIVENESS_GAP_MS`, so a worker that dies mid-tool surfaces in ~2 minutes instead of holding the full 14.5-minute grace.
