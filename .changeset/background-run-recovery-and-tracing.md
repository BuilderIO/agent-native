---
"@agent-native/core": minor
---

Make background agent runs recoverable, observable, and tunable.

A scheduled or queued automation runs the agent loop in-process, with no HTTP
body to re-POST and no server-driven continuation behind it. The run manager's
no-progress backstop nevertheless checkpointed for a continuation nobody was
going to run: it aborted the run's top-level controller, which is the same
signal the in-invocation recovery loop is gated on, so a healthy run that went
quiet for 150s between a completed tool and the next token was recorded as a
terminal `no_progress` failure.

- A checkpoint on a run that opts into `recoverChunkBoundaries` now ends the
  CHUNK, not the turn. `runAgentLoopDirectWithSoftTimeout` accepts the
  `RunChunkControl` `startRun` hands its `runFn` and continues, using the
  continuation budget that was already there. A user Stop, a hard timeout, and
  the cross-isolate abort check still end the turn immediately.
- The background automation runner is instrumented with `instrumentAgentLoop`,
  so scheduled runs produce `$ai_trace` / `$ai_span` events and local trace-store
  rows under their real owner instead of nothing. `instrumentAgentLoop` gained a
  `spanName` option and now forwards `metadata` to PostHog, so an automation is
  identifiable there.
- Boundaries are recorded: a `run_boundary_reached` diagnostic naming the
  segment that went silent, an `agent_run_boundary` analytics event dimensioned
  by reason and by whether a continuation followed, and a `captureError` for a
  checkpoint that terminates a run.
- `automation_runs` gained an `error_code` column, written from the code the
  failure taxonomy already computed, and `BackgroundAutomationDeps` gained an
  `onRunOutcome` callback that fires for success, cut-off, hard timeout, and
  dispatch failure alike.
- The run-lifecycle bounds that can terminate a run are configurable under
  `agent.*` with today's values as defaults, each behind one resolver, and their
  ordering relationships are asserted when configuration resolves. The
  background no-progress default is clamped to the chunk it guards, so lowering
  the global soft timeout cannot leave it unreachable.
- On a run that recovers boundaries in-invocation the run manager no longer arms
  its own soft-timeout timer: the agent-loop wrapper already races that same
  wall with a cumulative per-round budget, so a second timer fired exactly when
  the wrapper had nothing left to continue with. One wall, one clock.
- Trace finalization can no longer alter the run it observes. Assembly ran
  unguarded inside a `finally`, where a throw replaces the block's result — so a
  malformed payload could report a completed run as failed. That check
  catches the pair that shipped violated: the automation runner took a 13-minute
  chunk budget under its own 10-minute hard abort, so its recoverable boundary
  was dead code. The runner now derives that budget from its own hard abort.
