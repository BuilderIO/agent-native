# Execution lease and durable step journal

**Property (P8).** While its durable receipt is retained, a `never` execution
step runs its external effect at most once for its turn, across every run and
every lease generation, including deposed workers that are still running.
The configured retention cutoff ends this guarantee; post-retention reuse is
tracked as finding F7.

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
- `PruneWhileTurnActive = FALSE` in the main checks. The live-lease F2 check sets
  it to TRUE to race pruning; the late-effect F2 check leaves it FALSE to model
  an elapsed recovery cutoff. `PruneStep` preserves a live lease and recent
  unresolved receipts. After the cutoff, any unresolved receipt can be pruned
  with its expired lease once no turn run remains. The database cannot tell
  whether a detached handler will land later; same-turn reuse after this bounded
  retention is the F7 product boundary.
- This is a one-step turn model: after that step is completed, the modeled turn
  is over when no worker or effect remains in flight. The F2 check permits a
  same-turn continuation after an incorrect prune while the prior effect is
  still in flight. Reusing an expired `turnId` after its rows age out can start
  a fresh run while an old effect remains in flight; finding F7 records that
  behavior outside the active-turn retention guarantee.
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

## Results after the F2/F3 retention regression update

| Config                                                                    | Result                          | Distinct states | Time   |
| ------------------------------------------------------------------------- | ------------------------------- | --------------- | ------ |
| `ExecutionLease.cfg` (policy `never`, prune on)                           | pass                            | 79,347          | 2.0 s  |
| `ExecutionLeasePolicyFlip.cfg` (each run's policy chosen)                 | pass                            | 4,313,845       | 75.9 s |
| `sufficiency/fence-alone.cfg` dispatch keeps only the fence               | P8 and P1 hold                  | 79,347          | 1.9 s  |
| `sufficiency/clause-alone.cfg` dispatch keeps only the clause             | P8 holds                        | 126,387         | 2.6 s  |
| `mutations/a` dispatch without the fence                                  | P1 violated                     | 159             | 0.7 s  |
| `mutations/b` begin replays a dispatched never step                       | P8 violated                     | 26,764          | 1.1 s  |
| `mutations/c` action starts before dispatch commits                       | P8 violated                     | 2,450           | 0.8 s  |
| `mutations/d` claim takes a live lease from a running owner               | ClaimRespectsLiveOwner violated | 16              | 0.7 s  |
| `mutations/e` fence check commits before the write                        | P1 violated                     | 159             | 0.8 s  |
| `mutations/g` reset fallback lacks successor fence                        | P1 violated                     | 351             | 0.7 s  |
| `mutations/h` prune a live dispatched step before late effect             | P8 violated                     | 66,965          | 1.7 s  |
| `mutations/i-ignore-recovery-cutoff.cfg` prune a recent receipt           | P8 violated                     | 65,384          | 1.7 s  |
| `checks/F2-prune-under-live-lease.cfg` live-turn prune race               | pass                            | 72,909          | 2.2 s  |
| `checks/F2-late-effect-after-cutoff.cfg` prune expired receipt, no replay | pass                            | 79,347          | 2.1 s  |
| `checks/F3-policy-flip-forgets-dispatch.cfg` retry-safe policy flip       | pass                            | 4,313,845       | 67.8 s |
| `findings/F7-post-retention-same-turn-replay.cfg`                         | P8Strict violated (finding)     | 668,807         | 9.1 s  |

Each mutation config checks only the invariant it is meant to break, and the
runner requires that exact invariant to be the one violated. F2 and F3 now pass
as regression checks with the fixed protocol.

Mutation g removes the successor Current(q) condition from the reset
fallback. The resulting stale journal write violates P1, confirming that the
fallback's successor lease lock is required. Mutation h removes both active
retention guards; the F2 regression check must keep P8, while that mutation
lets a recovery attempt repeat an effect and violates P8.
Mutation i ignores the recovery cutoff after the lease expires. A recent
unknown receipt can then be pruned while its detached handler can still land,
and a same-turn continuation can invoke the step again, violating P8.

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
`dispatched` record and refuses the `never` replay. The unknown-step scenario
uses a `never` step, advances beyond the configured recovery window, and
confirms both its journal and expired lease are pruned. A separate late-effect
scenario confirms the receipt remains available during the recovery window.
Aged `prepared` rows with no dispatch history also prune with their expired
lease. Mutation h removes the live-lease and recent-step guards; mutation i
removes the recovery cutoff. Each can let a continuation repeat the same
`never` step and violate P8. Reuse after normal retention is tracked separately
as F7.

**F3, retry-safe adoption forgets dispatch — reproduced and fixed.** Seed
`20261027` dispatches a retry-safe step, adopts and redispatches it in a second
run, then cancels before invocation. The reset used to clear the first run's
dispatch marker, allowing a third run whose policy changed to `never` to invoke
the action again. `beginAgentExecutionStep` now treats non-null `dispatched_at`
as history, and the reset preserves it only when admission reports an earlier
dispatch. A first-attempt cancellation still clears its new marker, preserving
the known-no-effect retry path. The policy-flip retention scenario changes a
dispatched retry-safe step to `never` while its receipt is still within the
recovery window; the retry remains blocked, and the unknown receipt and lease
prune after the window expires.

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
- **F7, expired-turn replay — product contract unresolved.** After retention
  prunes a retry-safe unknown step and its expired lease, reusing the same
  `turnId` inserts a fresh `never` step even though the old handler may still
  land its effect. The new PGlite `it.fails` and TLA finding reproduce this
  boundary. Decide whether an expired turn ID starts a fresh execution or is
  rejected; without a turn tombstone, at-most-once cannot extend past retention.

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
concurrent-claim check) took 9.9 seconds locally. The property alone took
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
