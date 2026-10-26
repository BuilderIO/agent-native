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
- `PruneWhileTurnActive = FALSE` in the checks: the retention prune only
  reaches a turn that no worker or continuation will touch again. Finding F2
  shows what happens without it.
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

## Results against source snapshot c8190ab8

| Config                                                           | Result                          | Distinct states | Time   |
| ---------------------------------------------------------------- | ------------------------------- | --------------- | ------ |
| `ExecutionLease.cfg` (policy `never`, prune on)                  | pass                            | 45,902          | 5.4 s  |
| `ExecutionLeasePolicyFlip.cfg` (each run's policy chosen freely) | pass                            | 2,403,007       | 63.7 s |
| `sufficiency/fence-alone.cfg` dispatch keeps only the fence      | P8 and P1 hold                  | 45,902          | 1.8 s  |
| `sufficiency/clause-alone.cfg` dispatch keeps only the clause    | P8 holds                        | 71,679          | 2.1 s  |
| `mutations/a` dispatch without the fence (ownership clause kept) | P1 violated                     | 149             | 0.8 s  |
| `mutations/b` begin replays a dispatched never step              | P8 violated                     | 19,923          | 1.1 s  |
| `mutations/c` action starts before the dispatch commits          | P8 violated                     | 2,078           | 1.3 s  |
| `mutations/d` claim takes a live lease from a running owner      | ClaimRespectsLiveOwner violated | 16              | 1.0 s  |
| `mutations/e` fence check commits before the write               | P1 violated                     | 138             | 0.9 s  |
| mutations/g reset fallback without successor fence               | P1 violated                     | 331             | 0.9 s  |
| `findings/F2` prune reaches a turn that still sees work          | P8 violated                     | 75,455          | 2.9 s  |
| `findings/F3` policy flip after a retry-safe dispatch            | P8Strict violated               | 1,392,684       | 32.0 s |

Each mutation and finding config checks only the invariant it is meant to
break, and the runner requires that exact invariant to be the one violated.
All expected violations reproduced; the verifier exited 0.

Mutation g removes the successor Current(q) condition from the reset
fallback. The resulting stale journal write violates P1, confirming that the
fallback's successor lease lock is required.

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

**F1, lease-loss reason spelled two ways (code reading, not the model).** The
heartbeat aborts with `execution-lease-lost` (`agent/run-manager.ts:1725`), but
finalization only skips the terminal write for `execution_lease_lost`
(`run-manager.ts:2452`; `server/agent-chat-plugin.ts:942` uses the underscore
form). So on every heartbeat-detected lease loss:

1. The heartbeat's renew fails with `stale_execution_fence` and aborts the run
   in memory with `execution-lease-lost`.
2. Finalization does not match the reason, so it calls `markRunAborted` under
   the worker's fence.
3. The fence is stale, so the write fails, is reported, and is rethrown.
4. The run row stays `running` until a reaper reaches it.

Fix: use one shared constant for the reason.

**F2, the retention prune can erase the step journal of a turn that still
sees work** (`pruneAndRollUpPrunedRunOutcomes`, `agent/run-store.ts:5166-5188`).
The step and lease deletes look only at age and at whether any run row of the
turn remains; they never check the lease. Counterexample:

1. Run 1 claims generation 1, begins the step, marks it dispatched, and the
   effect runs.
2. A stop request aborts run 1 before it completes the step, so the step stays
   `dispatched`.
3. After retention, the prune deletes run 1's row, then the step row, because
   no run row of the turn remains.
4. A continuation arrives with the same turn id (turn ids come from the
   request, `production-agent.ts:14815-14822`, `background-automation-runner.ts:1476`)
   and inserts run 2, which claims the lease.
5. Run 2 begins the step, finds no row, inserts a fresh `prepared` row,
   dispatches, and the effect runs a second time.

The same erase happens through a worker that outlives retention, or through a
low retention setting. `AGENT_RUN_RETENTION_MS` (24 h by default) and
`AGENT_ERRORED_RUN_RETENTION_MS` (7 d) may both be 0
(`app-config/agent.ts:95-110`), and a cutoff below the 15 s lease TTL lets the
lease delete reach a live lease. Not yet confirmed: whether a late
continuation re-issues the same call once its tool-call journal rows are gone
too. Fix: skip turns with a live lease or any non-terminal step in the step
and lease deletes, and give both retention settings a floor above the lease
TTL plus the recovery window.

**F3, a dispatched retry-safe step forgets it was dispatched after
re-adoption** (`beginAgentExecutionStep`, `run-store.ts:795-809`).
Counterexample, with a deploy that changes the action's replay policy between
runs of one turn:

1. Run 2 (retry-safe) dispatches the step and the effect runs.
2. Run 2's run row ends (`completed`) before it completes the step, so the step
   stays `dispatched`. Run 3 (retry-safe) claims, and begin re-adopts the
   dispatched step, which is allowed for retry-safe. The step status goes back
   to `prepared`.
3. Run 3 stops before dispatching.
4. Run 1, on the deploy where the action is now `never`, claims. Begin sees
   `prepared`, adopts it, and the effect runs again, although `never`
   promised no repeat.

This needs an action's retry safety to change while a turn is in flight, so
the practical risk is low. Fix: `dispatched_at` survives re-adoption, so begin
can treat a `prepared` row with `dispatched_at` set as already dispatched when
it decides whether a `never` intent may run.

## Outside the model: step identity (from review, not model-checked)

P8 holds per step row. These paths can give a repeated call a different step
row, so they need their own model or fix. Each is from code reading and was
not reproduced.

- **F4, likely: an agent-teams retry after a crash repeats a never-replay
  call.** A retry with no prior continuation starts in "start" mode with only
  the task description (`server/agent-teams.ts:2484-2513`). Interrupted
  journal entries are seeded only for internal continuations
  (`production-agent.ts:7519-7527`), and the step id hashes the turn prefix,
  which holds the provider's tool-call ids (`production-agent.ts:8365-8372`).
  A re-planned call therefore gets a new step row, and the effect runs again.
  Suggested fix: seed interrupted journal entries for every turn, not only
  internal continuations.
- **F5, suspected: an integration task retry is a new turn.** Without durable
  dispatch, a stuck or failed integration task is reset to pending and claimed
  again with a new run and turn (`integrations/pending-tasks-retry-job.ts`,
  `integrations/webhook-handler.ts:1143-1180`), so neither journal sees the
  first attempt.
- **F6, suspected: the integration and Google Docs poller loops do not make
  `tool_start` durable before dispatch** (`integrations/webhook-handler.ts:1273-1283`:
  no `beforeWrite`, and `send` does not return the persistence promise). A
  crash after the effect leaves no interrupted entry for the next chunk.

## Code to model map

Paths are under `packages/core/src/`. Every action in `ExecutionLease.tla`
cites the lines it models.

Drift coverage (`manifest.json`, 43 entries) hashes the code in this map, the
step-intent and replay-policy derivation in `production-agent.ts`, and the
helpers that compute the policy's inputs: `classifyActionCall`,
`actionCallIntent`, `preparedCallArguments`, `actionCallIsRetrySafe`,
`coerceGatewayStringifiedArgs`, `validateActionArgs` and
`snapshotActionArguments`. It stops there on purpose: hashing every transitive
dependency would flag most core changes. Deeper helpers rely on their own unit
tests.

| Code                                                                                                       | Model action                                                                     |
| ---------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `agent/run-store.ts` `claimExecutionLease`                                                                 | `Claim`                                                                          |
| `renewExecutionLease`                                                                                      | `Renew`                                                                          |
| `releaseTurnExecutionLease`                                                                                | `WorkerRelease`                                                                  |
| `agent/execution-fence.ts` `withFencedExecutionWrite`, `lockAndAssertCurrentExecutionFences`               | `Current`, `FenceOK` in every fenced action                                      |
| `beginAgentExecutionStep`                                                                                  | `BeginStep`                                                                      |
| `markAgentExecutionStepDispatched`                                                                         | `MarkDispatched`                                                                 |
| `resetAgentExecutionStepBeforeInvocation`                                                                  | `ResetBeforeInvocation` (direct fence, or locked current-owner reconciliation)   |
| `completeAgentExecutionStep`                                                                               | `CompleteStep`                                                                   |
| `markAgentExecutionStepUnknown`                                                                            | `MarkUnknown`                                                                    |
| `recordLateAgentExecutionStepOutcome`, `withAgentExecutionStepIntentFence`                                 | `LateOutcome`                                                                    |
| `updateRunStatusIfRunning`                                                                                 | `WorkerTerminal` (fenced), `TerminaliseUnclaimed` (unfenced setup failures)      |
| `revokeTaskExecutionLease`, `revokeExecutionLeasesForRuns`                                                 | `LeaseLapse`                                                                     |
| `updateRunAborted`                                                                                         | `StopRun`                                                                        |
| `markTurnAborted`                                                                                          | `AbortTurn`                                                                      |
| `reapSingleStaleRun`, `failRunBeforeDispatch`                                                              | `ReapOrFailUnowned`                                                              |
| `finalizeClaimedBackgroundRunFailure`                                                                      | `FinalizeClaimedFailure`                                                         |
| `releaseBackgroundRunBeforeStart`, `reapUnclaimedBackgroundRun`                                            | `TerminaliseUnclaimed`                                                           |
| `insertRun`, `tryClaimRunSlot`, `attemptStaleRunRecovery`                                                  | `InsertRun`                                                                      |
| `pruneAndRollUpPrunedRunOutcomes`                                                                          | `PruneRun`, `PruneStep`, `PruneLease`                                            |
| `agent/production-agent.ts` `invokeAction`, `jobs/background-automation-runner.ts` `confirmAutomationWork` | `MarkDispatched`, then `InvokeHandler` before `Effect`; reset may win in between |
| `agent/production-agent.ts` step-intent region (fence lookup through `beginAgentExecutionStep`)            | `BeginStep` preconditions: intent only under a fence, policy per run             |
| `currentExecutionFence`, `currentExecutionFenceForScope`, `withExecutionFence`, `lockTurnExecutionLease`   | `Current`, `Claim`, reaper and abort lease locks                                 |
