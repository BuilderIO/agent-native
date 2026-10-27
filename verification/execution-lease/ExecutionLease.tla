--------------------------- MODULE ExecutionLease ---------------------------
(***************************************************************************)
(* Turn execution lease + durable step journal, for one (thread, turn) and  *)
(* one durable execution step.                                              *)
(*                                                                          *)
(* Paths are relative to packages/core/src/:                                *)
(*   RS  = agent/run-store.ts          RM  = agent/run-manager.ts           *)
(*   EF  = agent/execution-fence.ts    PA  = agent/production-agent.ts      *)
(*   BAR = jobs/background-automation-runner.ts                             *)
(* Line numbers are at HEAD 38ce309e5da9.                                   *)
(*                                                                          *)
(* One action = one real atomic unit: a BEGIN..COMMIT transaction, one     *)
(* autocommit statement, or (Effect) the tool's external side effect.       *)
(* Time is modelled only as "a live lease may stop being live at any        *)
(* moment" (LeaseLapse).                                                    *)
(***************************************************************************)
EXTENDS Naturals, Sequences, FiniteSets, TLC

CONSTANTS
  Runs,           \* agent_runs ids that belong to this turn
  NoRun,          \* stands for an empty owner / run_id column
  PolicyChoices,  \* intent.replayPolicy values a run's deploy may use
  Mutation,       \* "none" or one of "a".."g" (broken variants, see NOTES.md)
  WithPrune,      \* include the retention prune (RS:5126-5258)
  PruneWhileTurnActive \* the prune may reach a turn that can still see
                       \* work: see PruneRun, PruneLease, InsertRun

ASSUME NoRun \notin Runs
ASSUME PolicyChoices \subseteq {"never", "retry-safe", "read-only"}
ASSUME Mutation \in {"none", "a", "b", "c", "d", "e", "f", "g"}
ASSUME WithPrune \in BOOLEAN
ASSUME PruneWhileTurnActive \in BOOLEAN

Terminal  == {"completed", "truncated", "errored", "aborted"}  \* RS:492-496
Present   == {"running"} \cup Terminal                         \* a row exists
RunStatus == {"absent", "pruned"} \cup Present
Policies  == {"never", "retry-safe", "read-only"}
Gens      == 0..Cardinality(Runs)  \* 0 = NULL; each run claims at most once
StepStatus == {"prepared", "dispatched", "unknown", "completed"}
\* Worker program counter for the one step (PA:9360-10380, BAR:1173-1238).
WPC == {"idle", "begin", "dispatch", "dispatch-started", "invoke",
        "finish", "late", "done"}

NoLease == [exists |-> FALSE, owner |-> NoRun, gen |-> 0, live |-> FALSE]
NoStep  == [exists |-> FALSE, status |-> "none", run |-> NoRun, gen |-> 0,
            policy |-> "none", dispatchedAt |-> FALSE,
            wasDispatched |-> FALSE]

VARIABLES
  policy,        \* intent.replayPolicy each run's deploy computes (PA:9377-9381)
  rstatus,       \* agent_runs.status
  wg,            \* agent_runs.worker_generation (0 = NULL)
  lease,         \* agent_execution_leases row for the turn
  step,          \* agent_execution_steps row for the step
  wpc,           \* worker program counter
  effectPending, \* the action is invoked but its external effect has not landed
  checked,       \* mutation e only: lease check committed, write not yet run
  effects,       \* history: every external effect <<[run, gen, policy]>>
  dead,          \* history: (owner, gen) pairs that were live and stopped being
  staleWrite,    \* history: a step-journal write committed by a non-current owner
  liveSteal      \* history: a claim superseded a live lease of a running owner

vars == <<policy, rstatus, wg, lease, step, wpc, effectPending, checked,
              effects, dead, staleWrite, liveSteal>>

Perms == Permutations(Runs)

(* The fence check of lockAndAssertCurrentExecutionFences (EF:120-143):     *)
(* owner_run_id = r AND generation = g AND lease_expires_at > now, FOR UPDATE*)
Current(r) == /\ wg[r] # 0
              /\ lease.exists /\ lease.live
              /\ lease.owner = r /\ lease.gen = wg[r]

(* withFencedExecutionWrite (EF:145-182) runs the check and the write in one *)
(* transaction. Mutation e splits them: FenceCheck commits first, the write  *)
(* later relies on that stale answer.                                        *)
FenceOK(r) == IF Mutation = "e" THEN checked[r] ELSE Current(r)
UseFence(r) == checked' = [checked EXCEPT ![r] = FALSE]
\* P1 bookkeeping for writes to agent_execution_steps: a write that changed
\* the row while its writer was not the current live owner. Comes last in
\* an action, after step'.
JournalWrite(r) == /\ UseFence(r)
                   /\ staleWrite' = (staleWrite \/ (step' # step /\ ~Current(r)))

StepMine(r) == step.exists /\ step.run = r /\ step.gen = wg[r]
Adopt(r) == [exists |-> TRUE, status |-> "prepared", run |-> r,
             gen |-> wg[r], policy |-> policy[r],
             dispatchedAt |-> step.dispatchedAt,
             wasDispatched |-> (step.wasDispatched \/ step.dispatchedAt
                                 \/ step.status \in {"dispatched", "unknown"})]
NoPresentRun == \A q \in Runs : rstatus[q] \notin Present

\* History for P6: a (owner, gen) pair dies when it stops being the live lease.
\* Every action except Effect ends with RetireDead.
Retire(old, new) ==
  IF old.exists /\ old.live
     /\ ~(new.exists /\ new.live /\ new.owner = old.owner /\ new.gen = old.gen)
  THEN dead \cup {<<old.owner, old.gen>>}
  ELSE dead
RetireDead == dead' = Retire(lease, lease')

-----------------------------------------------------------------------------
Init ==
  /\ policy \in [Runs -> PolicyChoices]
  /\ rstatus \in {f \in [Runs -> {"absent", "running"}] :
                    \E q \in Runs : f[q] = "running"}
  /\ wg = [r \in Runs |-> 0]
  /\ lease = NoLease
  /\ step = NoStep
  /\ wpc = [r \in Runs |-> "idle"]
  /\ effectPending = [r \in Runs |-> FALSE]
  /\ checked = [r \in Runs |-> FALSE]
  /\ effects = <<>>
  /\ dead = {}
  /\ staleWrite = FALSE
  /\ liveSteal = FALSE

-----------------------------------------------------------------------------
(*************************** Worker of run r *******************************)

\* W2 claimExecutionLease, RS:443-529 (via claimTurnExecutionLease RS:426,
\* called at RM:998-1000). L2 advisory lock RS:455; lease FOR UPDATE RS:459-466;
\* own run must be 'running' RS:467-477; Busy iff the lease is live and the
\* prior owner's row is not terminal (a missing row is not terminal) RS:484-499;
\* UPSERT generation+1 RS:501-515; worker_generation RS:521-526.
\* A failed claim aborts the worker in memory (RM:1002-1021); that is the
\* worker never acting again, so it needs no action.
Claim(r) ==
  /\ wpc[r] = "idle"
  /\ rstatus[r] = "running"
  /\ LET busy == lease.exists /\ lease.live
                 /\ rstatus[lease.owner] \notin Terminal
     IN  Mutation = "d" \/ ~busy
  /\ LET g == IF lease.exists THEN lease.gen + 1 ELSE 1
     IN  /\ lease' = [exists |-> TRUE, owner |-> r, gen |-> g, live |-> TRUE]
         /\ wg' = [wg EXCEPT ![r] = g]
  /\ wpc' = [wpc EXCEPT ![r] = "begin"]
  /\ liveSteal' = (liveSteal \/ (lease.exists /\ lease.live
                                 /\ rstatus[lease.owner] = "running"))
  /\ UNCHANGED <<policy, rstatus, step, effectPending, checked, effects,
                 staleWrite>>
  /\ RetireDead

\* W3 renewExecutionLease, RS:563-603 (RM:1706-1716, every 1.5 s). The UPDATE
\* requires owner, generation and lease_expires_at > clock_timestamp()
\* (RS:573-580), so it only keeps a live lease live: a stutter step here.
\* Its agent_runs UPDATE (RS:591-599) ignores rowsAffected, so a run that is
\* no longer 'running' keeps its lease alive.
Renew(r) ==
  /\ Current(r)
  /\ lease' = [lease EXCEPT !.live = TRUE]
  /\ UNCHANGED <<policy, rstatus, wg, step, wpc, effectPending, checked,
                 effects, staleWrite, liveSteal>>
  /\ RetireDead

\* Mutation e only: the lease check of a fenced write commits in its own
\* transaction (EF:120-143 without EF:175-178 around the write).
FenceCheck(r) ==
  /\ Mutation = "e"
  /\ Current(r)
  /\ ~checked[r]
  /\ checked' = [checked EXCEPT ![r] = TRUE]
  /\ UNCHANGED <<policy, rstatus, wg, lease, step, wpc, effectPending,
                 effects, staleWrite, liveSteal>>
  /\ RetireDead

\* W6 beginAgentExecutionStep, RS:709-812, one fenced tx (RS:713 -> EF:175).
\* Callers: PA:9384-9386 (intent built only under a fence, PA:9360-9383) and
\* BAR:1197 (fence required, BAR:1173-1184). INSERT ... ON CONFLICT DO NOTHING
\* RS:716; SELECT ... FOR UPDATE RS:733; completed -> replay RS:764-770;
\* unknown and not replayable -> unknown RS:773-779; dispatched and not
\* replayable -> UPDATE status='unknown' RS:780-793; otherwise re-adopt with
\* this run/generation/policy RS:795-809 and return "execute".
\* canReplay: row.replay_policy = intent.replayPolicy AND intent in
\* {read-only, retry-safe} (RS:774-777, RS:781-784).
\* Mutation b: the dispatched branch re-adopts a never step instead.
\* Mutation c: "execute" also starts the action, in parallel with
\* markDispatched (so the effect no longer waits for PA:9909-9911).
BeginStep(r) ==
  /\ wpc[r] = "begin"
  /\ FenceOK(r)
  /\ LET canReplay == /\ step.policy = policy[r]
                      /\ policy[r] \in {"read-only", "retry-safe"}
         hadDispatch == step.status = "dispatched" \/ step.dispatchedAt
                         \/ step.wasDispatched \/ step.status = "unknown"
         execute ==
           /\ step' = Adopt(r)
           /\ wpc' = [wpc EXCEPT ![r] = IF Mutation = "c"
                                           THEN "dispatch-started"
                                           ELSE "dispatch"]
           /\ effectPending' = IF Mutation = "c"
                                 THEN [effectPending EXCEPT ![r] = TRUE]
                                 ELSE effectPending
         stop(s) ==
           /\ step' = s
           /\ wpc' = [wpc EXCEPT ![r] = "done"]
           /\ UNCHANGED effectPending
     IN  IF ~step.exists THEN execute
         ELSE IF step.status = "completed" THEN stop(step)
         ELSE IF step.status = "unknown" /\ ~canReplay THEN stop(step)
         ELSE IF hadDispatch /\ ~canReplay /\ Mutation # "b"
              THEN stop([step EXCEPT !.status = "unknown"])
         ELSE execute
  /\ UNCHANGED <<policy, rstatus, wg, lease, effects, liveSteal>>
  /\ RetireDead
  /\ JournalWrite(r)

\* W6 markAgentExecutionStepDispatched, RS:815-838, one fenced tx (RS:819):
\* UPDATE ... SET status='dispatched' WHERE run_id=? AND generation=? AND
\* status='prepared' (RS:822-825). Awaited before the action runs: PA:9909-9911
\* then runPreparedActionCall PA:9947; BAR:1227 then sendMessageToTarget
\* BAR:1228. A rowsAffected != 1 throws (RS:835-837), so this worker cannot
\* reach the pre-invocation or effect transitions.
\* Mutation a drops the fence and keeps the run_id/generation clause; f drops
\* the clause and keeps the fence. sufficiency/*.cfg check what each guard
\* alone still guarantees (NOTES.md).
MarkDispatched(r) ==
  /\ wpc[r] \in {"dispatch", "dispatch-started"}
  /\ Mutation = "a" \/ FenceOK(r)
  /\ step.exists /\ step.status = "prepared"
  /\ Mutation = "f" \/ StepMine(r)
  /\ step' = [step EXCEPT !.status = "dispatched", !.dispatchedAt = TRUE]
  /\ effectPending' = effectPending
  /\ wpc' = [wpc EXCEPT ![r] = IF wpc[r] = "dispatch-started"
                                  THEN "finish"
                                  ELSE "invoke"]
  /\ UNCHANGED <<policy, rstatus, wg, lease, effects, liveSteal>>
  /\ RetireDead
  /\ JournalWrite(r)

\* The second abort/timeout check has passed and actionInvoked is set just
\* before runPreparedActionCall (PA:10266-10322). No database guard follows.
InvokeHandler(r) ==
  /\ wpc[r] = "invoke"
  /\ rstatus[r] = "running"
  /\ ~effectPending[r]
  /\ StepMine(r) /\ step.status = "dispatched"
  /\ wpc' = [wpc EXCEPT ![r] = "finish"]
  /\ effectPending' = [effectPending EXCEPT ![r] = TRUE]
  /\ UNCHANGED <<policy, rstatus, wg, lease, step, checked, effects,
                 staleWrite, liveSteal>>
  /\ RetireDead

\* Cancellation can win after the durable dispatch marker but before the
\* handler starts. The direct write uses the old live fence. If that fence
\* went stale, the helper ignores only that exact ALS fence, locks the current
\* lease and running owner, then reassigns the still-old step row to them.
\* It never resets after InvokeHandler: that action may still be a zombie.
ResetBeforeInvocation(r) ==
  /\ wpc[r] = "invoke"
  /\ ~effectPending[r]
  /\ step.exists /\ step.status = "dispatched" /\ StepMine(r)
  /\ \/ /\ Current(r)
        /\ FenceOK(r)
        /\ step' = [step EXCEPT !.status = "prepared",
                                  !.dispatchedAt = step.wasDispatched]
        /\ wpc' = [wpc EXCEPT ![r] = "done"]
        /\ effectPending' = [effectPending EXCEPT ![r] = FALSE]
        /\ UNCHANGED <<policy, rstatus, wg, lease, effects, liveSteal>>
        /\ UseFence(r)
        /\ JournalWrite(r)
        /\ RetireDead
     \/ \E q \in Runs :
          /\ q # r
          /\ ~Current(r)
          /\ Current(q)
          /\ rstatus[q] = "running"
          /\ step' = [step EXCEPT !.status = "prepared",
                                    !.run = q, !.gen = wg[q],
                                    !.dispatchedAt = step.wasDispatched]
          /\ wpc' = [wpc EXCEPT ![r] = "done"]
          /\ effectPending' = [effectPending EXCEPT ![r] = FALSE]
          /\ staleWrite' = staleWrite \/ (step' # step /\ ~Current(q))
          /\ UNCHANGED <<policy, rstatus, wg, lease, checked, effects,
                         liveSteal>>
          /\ RetireDead

\* Mutation g drops the successor lease check before rewriting the step owner.
ResetBeforeInvocationWithoutSuccessorFence(r) ==
  /\ Mutation = "g"
  /\ wpc[r] = "invoke"
  /\ ~effectPending[r]
  /\ step.exists /\ step.status = "dispatched" /\ StepMine(r)
  /\ \E q \in Runs :
       /\ q # r
       /\ ~Current(r)
       /\ ~Current(q)
       /\ rstatus[q] = "running"
       /\ step' = [step EXCEPT !.status = "prepared",
                                 !.run = q, !.gen = wg[q],
                                 !.dispatchedAt = step.wasDispatched]
       /\ wpc' = [wpc EXCEPT ![r] = "done"]
       /\ effectPending' = [effectPending EXCEPT ![r] = FALSE]
       /\ staleWrite' = TRUE
       /\ UNCHANGED <<policy, rstatus, wg, lease, checked, effects, liveSteal>>
       /\ RetireDead

\* W7 the external effect: runPreparedActionCall PA:9947 (inside invokeAction,
\* PA:9896-9961) or adapter.sendMessageToTarget BAR:1228. No DB guard. It may
\* land at any later time, also after the run timed it out and moved on
\* (the zombie promise, PA:9963-10075).
Effect(r) ==
  /\ effectPending[r]
  /\ effects' = Append(effects, [run |-> r, gen |-> wg[r], policy |-> policy[r]])
  /\ effectPending' = [effectPending EXCEPT ![r] = FALSE]
  /\ UNCHANGED <<policy, rstatus, wg, lease, step, wpc, checked, dead,
                 staleWrite, liveSteal>>

\* completeAgentExecutionStep, RS:843-871, fenced (RS:849):
\* WHERE run_id, generation AND status='dispatched' (RS:852-855).
\* Callers PA:10351, BAR:1229.
CompleteStep(r) ==
  /\ wpc[r] \in {"finish", "invoke"}
  /\ (wpc[r] = "finish" \/ step.policy = "read-only")
  /\ FenceOK(r)
  /\ StepMine(r) /\ step.status = "dispatched"
  /\ step' = [step EXCEPT !.status = "completed"]
  /\ wpc' = [wpc EXCEPT ![r] = "done"]
  /\ UNCHANGED <<policy, rstatus, wg, lease, effectPending, effects,
                 liveSteal>>
  /\ RetireDead
  /\ JournalWrite(r)

\* markAgentExecutionStepUnknown, RS:875-911, fenced (RS:879): UPDATE
\* status='unknown' WHERE run_id, generation AND status='dispatched'
\* (RS:882-886). Caller PA:10347-10349 (timed out or lost result).
MarkUnknown(r) ==
  /\ wpc[r] = "finish"
  /\ FenceOK(r)
  /\ StepMine(r) /\ step.status = "dispatched"
  /\ step' = [step EXCEPT !.status = "unknown"]
  /\ wpc' = [wpc EXCEPT ![r] = "late"]
  /\ UNCHANGED <<policy, rstatus, wg, lease, effectPending, effects,
                 liveSteal>>
  /\ RetireDead
  /\ JournalWrite(r)

\* recordLateAgentExecutionStepOutcome, RS:918-947, through
\* withAgentExecutionStepIntentFence RS:645-701 (same lease predicate, with or
\* without an ALS fence): status IN ('dispatched','unknown') -> 'completed'.
\* Caller: the zombie continuation PA:10029-10031.
LateOutcome(r) ==
  /\ wpc[r] \in {"finish", "late"}
  /\ FenceOK(r)
  /\ StepMine(r) /\ step.status \in {"dispatched", "unknown"}
  /\ step' = [step EXCEPT !.status = "completed"]
  /\ wpc' = [wpc EXCEPT ![r] = "done"]
  /\ UNCHANGED <<policy, rstatus, wg, lease, effectPending, effects,
                 liveSteal>>
  /\ RetireDead
  /\ JournalWrite(r)

\* W9(C) the worker's own terminal status: updateRunStatusIfRunning RS:3117
\* (WHERE status='running'), fenced, from RM:2256, after onComplete (RM:2181)
\* and the agent loop, so only once the step is past dispatch. A detached
\* continuation can still record a late outcome (LateOutcome) after it.
\* Once this commits, a successor may claim the still-live lease (RS:492-499).
WorkerTerminal(r) ==
  /\ wg[r] # 0
  /\ wpc[r] \in {"finish", "late", "done"}
  /\ FenceOK(r)
  /\ rstatus[r] = "running"
  /\ UseFence(r)
  /\ rstatus' = [rstatus EXCEPT ![r] = "completed"]
  /\ UNCHANGED <<policy, wg, lease, step, wpc, effectPending, effects,
                 staleWrite, liveSteal>>
  /\ RetireDead

\* The worker's process stops acting: it finished, crashed, or its request
\* was torn down. An effect already in flight (effectPending) may still land.
WorkerStops(r) ==
  /\ wpc[r] \notin {"idle", "done"}
  /\ wpc' = [wpc EXCEPT ![r] = "done"]
  /\ UNCHANGED <<policy, rstatus, wg, lease, step, effectPending, checked,
                 effects, dead, staleWrite, liveSteal>>

\* W11 releaseTurnExecutionLease, RS:606-626 (RM:2598-2617): own tx,
\* UPDATE lease_expires_at = now WHERE owner, generation and live.
WorkerRelease(r) ==
  /\ Current(r)
  /\ lease' = [lease EXCEPT !.live = FALSE]
  /\ UNCHANGED <<policy, rstatus, wg, step, wpc, effectPending, checked,
                 effects, staleWrite, liveSteal>>
  /\ RetireDead

-----------------------------------------------------------------------------
(*************************** Outsiders ***************************************)

\* The lease stops being live with no owner/generation check:
\*  - expiry: lease_expires_at > clock_timestamp() turns false (RS:419);
\*  - revokeTaskExecutionLease RS:3636-3647 (WHERE thread, turn only), used by
\*    the team busy-loser path agent-teams-run-queue.ts:311-312 and the A2A
\*    task store;
\*  - revokeExecutionLeasesForRuns RS:3649-3661 (WHERE owner_run_id IN, no gen).
LeaseLapse ==
  /\ lease.exists /\ lease.live
  /\ lease' = [lease EXCEPT !.live = FALSE]
  /\ UNCHANGED <<policy, rstatus, wg, step, wpc, effectPending, checked,
                 effects, staleWrite, liveSteal>>
  /\ RetireDead

\* A1 updateRunAborted RS:3464-3576 from a stop request with no fence
\* (abortRunDurably RM:3600-3617): UPDATE status='aborted' WHERE status=
\* 'running' (RS:3525), then revokeExecutionLeasesForRuns([r]) (RS:3535) in
\* the same tx.
StopRun(r) ==
  /\ rstatus[r] = "running"
  /\ rstatus' = [rstatus EXCEPT ![r] = "aborted"]
  /\ lease' = IF lease.exists /\ lease.owner = r
                THEN [lease EXCEPT !.live = FALSE] ELSE lease
  /\ UNCHANGED <<policy, wg, step, wpc, effectPending, checked, effects,
                 staleWrite, liveSteal>>
  /\ RetireDead

\* A2 markTurnAborted RS:3667-3851 (no fence): revoke the leases of the
\* turn's running runs (RS:3706-3707), abort them all (RS:3710).
AbortTurn ==
  /\ \E q \in Runs : rstatus[q] = "running"
  /\ rstatus' = [q \in Runs |-> IF rstatus[q] = "running" THEN "aborted"
                                ELSE rstatus[q]]
  /\ lease' = IF lease.exists /\ rstatus[lease.owner] = "running"
                THEN [lease EXCEPT !.live = FALSE] ELSE lease
  /\ UNCHANGED <<policy, wg, step, wpc, effectPending, checked, effects,
                 staleWrite, liveSteal>>
  /\ RetireDead

\* R1 reapSingleStaleRun RS:2770-3015 and D5 failRunBeforeDispatch
\* RS:3305-3384. Both lock the lease (RS:2821, RS:3331) and the run row and
\* refuse when the lease is live and names r with r's generation
\* (RS:2833-2840, RS:3346-3352). Otherwise the run becomes 'errored' (T4
\* repair RS:2842 or the stale UPDATE). The reaper's revoke (RS:2872-2877) only
\* hits a lease that is already not live. Heartbeat staleness is left
\* nondeterministic.
ReapOrFailUnowned(r) ==
  /\ rstatus[r] = "running"
  /\ ~(lease.exists /\ lease.live /\ lease.owner = r /\ lease.gen = wg[r])
  /\ rstatus' = [rstatus EXCEPT ![r] = "errored"]
  /\ UNCHANGED <<policy, wg, lease, step, wpc, effectPending, checked,
                 effects, staleWrite, liveSteal>>
  /\ RetireDead

\* D6 finalizeClaimedBackgroundRunFailure RS:3182-3303: owner and generation
\* must match (RS:3247-3252), liveness is NOT checked, and the lease is NOT
\* revoked. (Its "no lease and worker_generation NULL" branch is
\* TerminaliseUnclaimed.)
FinalizeClaimedFailure(r) ==
  /\ rstatus[r] = "running"
  /\ wg[r] # 0
  /\ lease.exists /\ lease.owner = r /\ lease.gen = wg[r]
  /\ rstatus' = [rstatus EXCEPT ![r] = "errored"]
  /\ UNCHANGED <<policy, wg, lease, step, wpc, effectPending, checked,
                 effects, staleWrite, liveSteal>>
  /\ RetireDead

\* Terminal writes made before the run's worker claims a lease:
\* D4 unfenced updateRunStatusIfRunning on setup failure (PA:12113, 12421,
\* 15062, 15138, 15243, 15364); D7 releaseBackgroundRunBeforeStart RS:3387;
\* U3 reapUnclaimedBackgroundRun RS:3029. Guard: status='running' only.
TerminaliseUnclaimed(r) ==
  /\ rstatus[r] = "running"
  /\ wpc[r] = "idle"
  /\ rstatus' = [rstatus EXCEPT ![r] = "errored"]
  /\ UNCHANGED <<policy, wg, lease, step, wpc, effectPending, checked,
                 effects, staleWrite, liveSteal>>
  /\ RetireDead

\* insertRun RS:1201-1303 / tryClaimRunSlot RS:1794-2000 of another run in the
\* same turn: a recovery successor (attemptStaleRunRecovery RS:2557-2679,
\* inserted inside the reaper tx that holds the predecessor row), a
\* continuation, or a team attempt. The turn id comes from the request
\* (PA:14815-14822, BAR:1476), so a continuation can also arrive after the
\* turn's rows were pruned; that case is PruneWhileTurnActive.
\* For this one-step model, a post-prune continuation is active only while
\* the step is incomplete. A completed step ends the modeled turn.
InsertRun(r) ==
  /\ rstatus[r] = "absent"
  /\ (IF PruneWhileTurnActive
      THEN step.exists /\ step.status # "completed"
      ELSE \E q \in Runs : rstatus[q] \in Present)
  /\ rstatus' = [rstatus EXCEPT ![r] = "running"]
  /\ UNCHANGED <<policy, wg, lease, step, wpc, effectPending, checked,
                 effects, staleWrite, liveSteal>>
  /\ RetireDead

\* Retention prune, pruneAndRollUpPrunedRunOutcomes RS:5126-5258 (one tx,
\* no lease lock). Ages are nondeterministic.
\* DELETE agent_runs: terminal and older than the retention cutoff
\* (RS:5143-5155). Retention is AGENT_RUN_RETENTION_MS (24 h by default, RM:226)
\* or AGENT_ERRORED_RUN_RETENTION_MS (7 d, RM:228); both may be set to 0
\* (app-config/agent.ts:95-110), and the step and lease deletes use the larger
\* (RS:5303-5305). Ages are not modelled: unless PruneWhileTurnActive, the age
\* stands in for run worker completion. The F2 regression check permits
\* pruning to race recovery while an incomplete step remains.
WorkerGone(r) == wpc[r] \in {"idle", "done"} /\ ~effectPending[r]
PruneRun(r) ==
  /\ WithPrune
  /\ rstatus[r] \in Terminal
  /\ PruneWhileTurnActive \/ WorkerGone(r)
  /\ rstatus' = [rstatus EXCEPT ![r] = "pruned"]
  /\ UNCHANGED <<policy, wg, lease, step, wpc, effectPending, checked,
                 effects, staleWrite, liveSteal>>
  /\ RetireDead

\* DELETE agent_execution_steps: older than the cutoff and no agent_runs row of
\* the turn (RS:5166-5177). It also keeps rows while the lease is live or any
\* step in the turn is incomplete.
PruneStep ==
  /\ WithPrune
  /\ step.exists
  /\ NoPresentRun
  /\ ~lease.live
  /\ step.status = "completed"
  /\ step' = NoStep
  /\ UNCHANGED <<policy, rstatus, wg, lease, wpc, effectPending, checked,
                 effects, staleWrite, liveSteal>>
  /\ RetireDead

\* DELETE agent_execution_leases: updated_at older than the cutoff and no
\* agent_runs row of the turn (RS:5178-5188). The lease must be expired and
\* the turn must have no incomplete step. The next claim restarts at gen 1.
PruneLease ==
  /\ WithPrune
  /\ lease.exists
  /\ ~lease.live
  /\ NoPresentRun
  /\ (step.status = "none" \/ step.status = "completed")
  /\ lease' = NoLease
  /\ UNCHANGED <<policy, rstatus, wg, step, wpc, effectPending, checked,
                 effects, staleWrite, liveSteal>>
  /\ RetireDead

-----------------------------------------------------------------------------
Next ==
  \/ \E r \in Runs : Claim(r)
  \/ \E r \in Runs : Renew(r)
  \/ \E r \in Runs : FenceCheck(r)
  \/ \E r \in Runs : BeginStep(r)
  \/ \E r \in Runs : MarkDispatched(r)
  \/ \E r \in Runs : InvokeHandler(r)
  \/ \E r \in Runs : ResetBeforeInvocation(r)
  \/ \E r \in Runs : ResetBeforeInvocationWithoutSuccessorFence(r)
  \/ \E r \in Runs : Effect(r)
  \/ \E r \in Runs : CompleteStep(r)
  \/ \E r \in Runs : MarkUnknown(r)
  \/ \E r \in Runs : LateOutcome(r)
  \/ \E r \in Runs : WorkerTerminal(r)
  \/ \E r \in Runs : WorkerRelease(r)
  \/ \E r \in Runs : WorkerStops(r)
  \/ LeaseLapse
  \/ \E r \in Runs : StopRun(r)
  \/ AbortTurn
  \/ \E r \in Runs : ReapOrFailUnowned(r)
  \/ \E r \in Runs : FinalizeClaimedFailure(r)
  \/ \E r \in Runs : TerminaliseUnclaimed(r)
  \/ \E r \in Runs : InsertRun(r)
  \/ \E r \in Runs : PruneRun(r)
  \/ PruneStep
  \/ PruneLease

Spec == Init /\ [][Next]_vars

-----------------------------------------------------------------------------
TypeOK ==
  /\ policy \in [Runs -> Policies]
  /\ rstatus \in [Runs -> RunStatus]
  /\ wg \in [Runs -> Gens]
  /\ lease \in [exists : BOOLEAN, owner : Runs \cup {NoRun}, gen : Gens,
                live : BOOLEAN]
  /\ step \in [exists : BOOLEAN, status : StepStatus \cup {"none"},
               run : Runs \cup {NoRun}, gen : Gens,
               policy : Policies \cup {"none"},
               dispatchedAt : BOOLEAN, wasDispatched : BOOLEAN]
  /\ wpc \in [Runs -> WPC]
  /\ effectPending \in [Runs -> BOOLEAN]
  /\ checked \in [Runs -> BOOLEAN]
  /\ effects \in Seq([run : Runs, gen : Gens, policy : Policies])
  /\ dead \subseteq (Runs \X Gens)
  /\ staleWrite \in BOOLEAN
  /\ liveSteal \in BOOLEAN

IsNever(e) == e.policy = "never"

\* P8: the external effect of a never-replay step runs at most once, across
\* every run and every lease generation of the turn.
P8 == Len(SelectSeq(effects, IsNever)) <= 1

\* P8 read strictly when a deploy changes the policy between runs: once any
\* run executes the step under "never", that is the only effect it ever had.
P8Strict == (\E i \in 1..Len(effects) : IsNever(effects[i])) => Len(effects) = 1

\* P1: every committed step-journal write was made by the owner of the current
\* live generation at commit time.
P1 == ~staleWrite

\* P6: no resurrection: a (owner, gen) that stopped being live never is again.
P6 == (lease.exists /\ lease.live) => <<lease.owner, lease.gen>> \notin dead

\* Claim promise (TurnExecutionLeaseBusyError, RS:497-499): a claim never
\* supersedes a live lease whose owner run is still running.
ClaimRespectsLiveOwner == ~liveSteal

=============================================================================
