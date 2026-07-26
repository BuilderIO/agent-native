---
"@agent-native/core": patch
---

Bound what a single agent turn can spend, and stop paying for the same work twice.

- The configured iteration budget is now a real cap: the loop stops at a terminal
  `loop_limit` instead of nudging itself and resetting the counter, so the event
  the run manager, thread builder and client all already handled finally reaches
  them.
- New per-turn input-token ceiling (`AGENT_MAX_RUN_INPUT_TOKENS`, default 3M)
  that rides the continuation body, so chained chunks share one allowance rather
  than getting a fresh one each.
- A chained chunk now serves a read-only tool's journaled result from an earlier
  chunk of the same turn instead of re-running it, respecting `dedupe: false`
  and same-turn write invalidation.
- Turns are bounded by a 20-minute wall clock in addition to the run-count
  ledger, and both exhaustion paths end with a summary of what actually
  completed instead of a bare reason string.
- Token usage rows now carry run, thread and turn ids so spend is attributable.
- Anthropic-shaped engines split the system prompt at a stable/volatile boundary
  and cache the stable prefix for an hour, so mid-turn resource churn no longer
  invalidates the system prompt and tool schemas together.
- A failed continuation dispatch consults the successor's claim on every target,
  so a lost response no longer reports a handoff that actually landed.
- Per-tool timeouts are clamped to what can fire inside the run's own chunk
  budget.
- Builds that opt into durable background now fail loudly when the function
  cannot be emitted, assert the artifact on disk, keep the background Lambda
  warm, and report once per isolate when the deployed function is unreachable.
- Terminal run outcomes are rolled up into daily counters before pruning, so
  completion rates survive the asymmetric retention windows; a worker that dies
  mid-tool is now reaped in ~2 minutes instead of ~14.5.
