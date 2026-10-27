# Execution lease and durable step journal

**Property (P8).** A durable execution step whose replay policy is `never`
runs its external effect at most once for its turn, across every run and every
lease generation, including deposed workers that are still running.

**Harm if broken.** A tool call that must not repeat (an email send, a
non-idempotent write, an automation delivery) runs twice after a crash, a
takeover, or a redispatch.

Helper invariants, checked in the same runs:

- **P1, single writer.** Every committed write to `agent_execution_steps` was
  made by the owner of the current live lease generation. The reset fallback
  is attributed to the successor whose live lease and running run it locks.
- **P6, no resurrection.** A lease `(owner, generation)` that stopped being
  live never becomes live again.
- **ClaimRespectsLiveOwner.** A claim never supersedes a live lease whose
  owner run is still `running`.

## Scope

- One thread and turn, one step, three runs. Each run claims at most once, so
  there are up to three generations and chained takeovers. Checking is
  exhaustive within those bounds.
- P8 is checked per step row: every attempt of the call reaches the same step
  id. Whether a re-planned call gets the same step id is the tool-call
  journal's job and is not modelled (see "Outside the model").
- Time is modelled only as "a live lease may stop being live at any moment"
  (expiry, or a revoke with no owner check).
- Workers are adversarial. They keep acting until a database guard rejects
  them; the heartbeat abort and the 3 s abort poll are not relied on.
- The dispatched marker commits before handler entry. Cancellation can reset
  that marker only in the interval before handler entry; after entry the
  action may be a zombie and its effect may still land.
- A read-only cache hit may complete a dispatched step without entering the
  handler because it has no external effect.
- `PruneWhileTurnActive = FALSE` in the main checks. The F2 regression check
  sets it to TRUE so pruning can race recovery. `PruneStep` preserves a live
  lease and recent unresolved receipts; once the recovery window has passed,
  it can remove an unresolved step after no external effect remains pending.
  An aged `prepared` row with no dispatch history can also be removed because
  invocation only follows the committed dispatch marker.
- This is a one-step turn model: after that step is completed, the modeled turn
  is over when no worker or effect remains in flight. The F2 check permits a
  same-turn continuation after an incorrect prune while the prior effect is
  still in flight. A later re-submission after all workers and effects
  stop and all rows age out is outside the active-turn retention guarantee.
- Transactions are the Postgres ones the code opens, with `FOR UPDATE` and the
  turn advisory lock. Driver differences are not modelled.
- At the coverage sync revision, terminal projection retry-order bookkeeping
  is outside the lease model, and earlier-projection blockers restrict when
  reaping may terminalize a run. Run admission also has pending-inbox and
  pending-approval gates that the model omits, so `InsertRun` is an
  over-approximation. These changes do not add an unfenced step-journal write.
- A run stopped by request saves its completion under a fence with
  `outlivesStop` (`run-manager.ts` `withWorkerFence`), which
  `lockAndAssertCurrentExecutionFences` accepts while the lease row still names
  the run and generation, however expired. Writes in that callback pass this
  check when they go through `withFencedExecutionWrite`, such as the
  chat-thread projection (`updateThreadData`) and background-worker run
  diagnostics (`recordRunDiagnostic`); none of the framework's own writes in
  the callback is a step-journal write or an action effect, so `Current` stays
  the fence for every modelled action. Writes that bypass the helper are not fence-checked
  and are outside the model, such as completing the tracked progress run
  (`completeProgressRun`) and whatever app-supplied completion hooks do. A claim
  replaces owner and generation under the same row lock, so the stopped run's
  save cannot land in a successor's turn.
- Not covered: thread content folding, liveness (an abandoned run is
  eventually reaped or resumed), lock-order deadlocks, the team queue, and A2A
  task leases beyond their revoke.
- Approval scheduling between turns is outside this one-turn model. The queued
  submission approval gate only defers a new turn; it leaves the same-turn
  `InsertRun` transition and all execution lease and step journal writes unchanged.
  Stopping a completed approval pause also writes the turn-abort marker without
  changing a run or lease; this is a stuttering step for the model's `AbortTurn`.
  Explicit interruption records those same markers in the slot-admission
  transaction before inserting its replacement turn. Legacy turns tied without
  admission metadata retain every unresolved approval pause; interruption writes
  each completed pause's marker in that transaction. Completed runs and their
  leases remain unchanged; cross-turn admission is outside this model.

## Coverage review for MCP automation approval

The coverage refresh at `bc6ca396161a` re-read `beginAgentExecutionStep`,
`confirmAutomationWork`, and the production loop's fence-to-intent region.
The store still holds the lease fence and row lock while admitting a step;
completed results and non-replayable dispatched steps retain their existing
outcomes. Comparing the canonical arguments hash instead of JSON key order
changes intent identity validation, not the model's one-step lease protocol.
The loop now derives a stable step name from the checkpoint, action, arguments
hash and identical-call occurrence, and recovers the ledger's existing step
name. Step identity remains outside the one-step model as documented above.
The marked-automation delivery check precedes dispatch and can only refuse it;
`markAgentExecutionStepDispatched` still commits before adapter invocation.
No fence, dispatch ordering, reset, replay policy or lease transition changed,
so the existing model and its deliberate counterexamples remain applicable.

The subsequent merge of main `5252c0e3345b` retains its 44 coverage entries,
including `insertTurnAbortMarkers`. Re-reading that helper, `tryClaimRunSlot`
and `markTurnAborted` confirms that current-turn approval admission and
completed-pause interruption use the cross-turn scope described above. They
do not weaken step fencing or move an effect ahead of durable dispatch.

## Results after the F2/F3 regression model update

| Config                                                           | Result                          | Distinct states | Time   |
| ---------------------------------------------------------------- | ------------------------------- | --------------- | ------ |
| `ExecutionLease.cfg` (policy `never`, prune on)                  | pass                            | 43,211          | 1.7 s  |
| `ExecutionLeasePolicyFlip.cfg` (each run's policy chosen freely) | pass                            | 2,274,034       | 37.7 s |
| `sufficiency/fence-alone.cfg` dispatch keeps only the fence      | P8 and P1 hold                  | 43,211          | 1.4 s  |
| `sufficiency/clause-alone.cfg` dispatch keeps only the clause    | P8 holds                        | 68,110          | 1.7 s  |
| `mutations/a` dispatch without the fence (ownership clause kept) | P1 violated                     | 151             | 0.7 s  |
| `mutations/b` begin replays a dispatched never step              | P8 violated                     | 20,216          | 1.0 s  |
| `mutations/c` action starts before the dispatch commits          | P8 violated                     | 2,585           | 0.8 s  |
| `mutations/d` claim takes a live lease from a running owner      | ClaimRespectsLiveOwner violated | 16              | 0.9 s  |
| `mutations/e` fence check commits before the write               | P1 violated                     | 148             | 0.7 s  |
| `mutations/g` reset fallback without successor fence             | P1 violated                     | 334             | 0.7 s  |
| `mutations/h` prune a live dispatched step before a late effect  | P8 violated                     | 67,070          | 2.2 s  |
| `checks/F2` prune reaches a turn that still sees work            | pass                            | 72,909          | 2.3 s  |
| `checks/F3` policy flip after a retry-safe dispatch              | pass                            | 2,274,034       | 33.1 s |

Each mutation config checks only the invariant it is meant to break, and the
runner requires that exact invariant to be the one violated. F2 and F3 now pass
as regression checks with the fixed protocol.

Mutation g removes the successor Current(q) condition from the reset
fallback. The resulting stale journal write violates P1, confirming that the
fallback's successor lease lock is required. Mutation h removes both active
retention guards; the F2 regression check must keep P8, while that mutation
lets a recovery attempt repeat an effect and violates P8.

Observations:

- In `markAgentExecutionStepDispatched`, the fence alone keeps P8 and P1
  (`sufficiency/fence-alone.cfg`). The `run_id`/`generation` clause alone
  keeps P8 (`sufficiency/clause-alone.cfg`) but not P1: without the fence, a
  worker whose lease lapsed can still mark its own prepared row dispatched
  (`mutations/a`). All three run on every check. Keep both guards.
- `withFencedExecutionWrite` writes without a fence when there is no execution
  fence in async context (`execution-fence.ts:157-161`), and inside a scoped
  transaction it commits with the caller (`:168-170`). No current step-journal
  caller reaches either branch: production-agent builds the intent only under
  a fence, and the automation runner requires one. Routing every step write
  through `withAgentExecutionStepIntentFence` would make that structural.

## Findings

**F1, lease-loss reason spelling — resolved before this simulation change.**
The heartbeat and finalization use the shared
`EXECUTION_LEASE_LOST_ABORT_REASON` constant. The simulation's slow-tool lease
loss scenario verifies the abort reason against that constant.

**F2, retention can erase a live turn's step journal — reproduced and fixed.**
Seed `20261026` prunes the terminal run while its lease is still live. The test
proves the dispatched step is eligible by age, yet the prune removes neither
its journal nor lease; after lease expiry, recovery reads the preserved
`dispatched` record and refuses the `never` replay. Unresolved steps also pin
their lease only through the longest configured recovery window. The F2
unknown-step scenario observes that window, then advances past it and confirms
both journal and lease rows are pruned. Mutation h removes the live and
in-window guards; its late-continuation path finds two effects for the same
`never` step. A separate scenario confirms aged `prepared` rows with no
dispatch history are removed with their expired lease.

**F3, retry-safe adoption forgets dispatch — reproduced and fixed.** Seed
`20261027` dispatches a retry-safe step, adopts and redispatches it in a second
run, then cancels before invocation. The reset used to clear the first run's
dispatch marker, allowing a third run whose policy changed to `never` to invoke
the action again. `beginAgentExecutionStep` now treats non-null `dispatched_at`
as history, and the reset preserves it only when admission reports an earlier
dispatch. A first-attempt cancellation still clears its new marker, preserving
the known-no-effect retry path.

## Outside the model: step identity (from review, not model-checked)

P8 holds per step row. These paths concern call identity or event persistence,
which the execution-lease model does not cover.

- **F4, not reproduced in current recovery code.** Agent-team retries set
  `recoverCompletedExecutionSteps` after the first claim
  (`server/agent-teams.ts`), which seeds interrupted journal entries even
  when the retry replans from task text (`production-agent.ts`). The loop
  matches an unambiguous repeated call to its interrupted journal step
  (`tool-call-journal.ts`), so it does not create the new step row described
  by the original suspicion. This task did not add a separate team retry
  scenario; the behavior was confirmed by code-path review.
- **F5, product contract unresolved: an integration task retry defaults to a
  new turn.** The targeted run-manager scenario reproduces this: two attempts
  with no explicit `turnId` receive their `runId` as the turn id, so their step
  journals do not deduplicate. Its trace snapshot runs as a normal test; a
  separate assertion-only expected failure checks whether retry effects should
  deduplicate. Whether task retries should share a logical turn needs a product
  contract.
- **F6, not reproduced on current code.** `run-manager.ts` `send` returns the
  publication promise from `emitRunEvent`, which settles after the SQL event
  write; `runAgentLoop` awaits `send(tool_start)` before invoking a write
  action. The F6 scenario verified that `tool_start` was persisted before the
  action started. The integration loop's missing `beforeWrite` does not bypass
  this awaited event path.

## Deterministic simulation

`packages/core/src/agent/run-loop.sim.spec.ts` runs the real durable-step store
and production loop against PGlite. Vitest's virtual `Date` clock and a
`clock_timestamp()` SQL adapter share one time source; the model provider and
tool effects are scripted in-process. Outbound `fetch` is replaced by a
fail-closed boundary, and the suite fails if anything attempts a network call.
The fast-check property defaults to 24 command sequences and can be expanded
with `AGENT_RUN_SIM_SEEDS`. A failing property includes fast-check's seed and
the last compact event trace.

The full default simulation file (24 property runs plus named scenarios and a
concurrent-claim check) took 10.2 seconds locally. The property alone took
63.6 seconds with 64 runs.

## Code to model map

Paths are under `packages/core/src/`. Every action in `ExecutionLease.tla`
cites the lines it models.

Drift coverage (`manifest.json`, 45 entries) hashes the code in this map, the
step-intent and replay-policy derivation in `production-agent.ts`, and the
helpers that compute the policy's inputs: `classifyActionCall`,
`actionCallIntent`, `preparedCallArguments`, `actionCallIsRetrySafe`,
`coerceGatewayStringifiedArgs`, `validateActionArgs` and
`snapshotActionArguments`. It stops there on purpose: hashing every transitive
dependency would flag most core changes. Deeper helpers rely on their own unit
tests.

| Code                                                                                                       | Model action                                                                      |
| ---------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `agent/run-store.ts` `claimExecutionLease`                                                                 | `Claim`                                                                           |
| `renewExecutionLease`                                                                                      | `Renew`                                                                           |
| `releaseTurnExecutionLease`                                                                                | `WorkerRelease`                                                                   |
| `agent/execution-fence.ts` `withFencedExecutionWrite`, `lockAndAssertCurrentExecutionFences`               | `Current`, `FenceOK` in every fenced action                                       |
| `beginAgentExecutionStep`                                                                                  | `BeginStep`, including durable `dispatched_at` history                            |
| `markAgentExecutionStepDispatched`                                                                         | `MarkDispatched`                                                                  |
| `resetAgentExecutionStepBeforeInvocation`                                                                  | `ResetBeforeInvocation` (direct fence, or locked current-owner reconciliation)    |
| `completeAgentExecutionStep`                                                                               | `CompleteStep`                                                                    |
| `markAgentExecutionStepUnknown`                                                                            | `MarkUnknown`                                                                     |
| `recordLateAgentExecutionStepOutcome`, `withAgentExecutionStepIntentFence`                                 | `LateOutcome`                                                                     |
| `updateRunStatusIfRunning`                                                                                 | `WorkerTerminal` (fenced), `TerminaliseUnclaimed` (unfenced setup failures)       |
| `revokeTaskExecutionLease`, `revokeExecutionLeasesForRuns`                                                 | `LeaseLapse`                                                                      |
| `updateRunAborted`                                                                                         | `StopRun`                                                                         |
| `markTurnAborted`                                                                                          | `AbortTurn`                                                                       |
| `reapSingleStaleRun`, `failRunBeforeDispatch`                                                              | `ReapOrFailUnowned`                                                               |
| `finalizeClaimedBackgroundRunFailure`                                                                      | `FinalizeClaimedFailure`                                                          |
| `releaseBackgroundRunBeforeStart`, `reapUnclaimedBackgroundRun`                                            | `TerminaliseUnclaimed`                                                            |
| `insertRun`, `tryClaimRunSlot`, `attemptStaleRunRecovery`                                                  | `InsertRun`                                                                       |
| `pruneAndRollUpPrunedRunOutcomes`                                                                          | `PruneRun`, `PruneStep`, `PruneLease`, including lease and unfinished-step guards |
| `agent/production-agent.ts` `invokeAction`, `jobs/background-automation-runner.ts` `confirmAutomationWork` | `MarkDispatched`, then `InvokeHandler` before `Effect`; reset may win in between  |
| `agent/production-agent.ts` step-intent region (fence lookup through `beginAgentExecutionStep`)            | `BeginStep` preconditions: intent only under a fence, policy per run              |
| `agent/production-agent.ts` pre-invocation reset admission                                                 | `ResetBeforeInvocation` history carry-forward decision                            |
| `currentExecutionFence`, `currentExecutionFenceForScope`, `withExecutionFence`, `lockTurnExecutionLease`   | `Current`, `Claim`, reaper and abort lease locks                                  |
