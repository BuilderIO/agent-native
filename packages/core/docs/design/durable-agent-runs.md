# Design: Durable / Checkpointed Agent Runs

Status: proposed
Owner: core / run-manager
Related code: `packages/core/src/agent/run-manager.ts`,
`packages/core/src/agent/engine/builder-engine.ts`

## Problem

Hosted agent runs are bounded by a ~40s soft timeout enforced in
`run-manager.ts` (`DEFAULT_HOSTED_RUN_SOFT_TIMEOUT_MS = 40_000`, also the
`HOSTED_SOFT_TIMEOUT_CEILING_MS`). That budget is deliberate and correct: it
sits just under a stack of upstream walls that the framework does not control.

When the soft timeout fires, the run-manager aborts the current chunk, persists
the partial turn, writes a terminal event, and emits an `auto_continue` event
(`reason: "run_timeout"`) so the client transparently resumes the turn in a
fresh chunk. This works well for a single long model call that just needs more
wall-clock time.

It does **not** work well for long _multi-step_ operations. A turn that performs
many sequential side effects — for example an agent appending many dashboard
panels through many separate write calls, or any "do N independent mutations in
a loop" workflow — fails in a characteristic way:

- **Continuation thrash / re-hydration.** Each `auto_continue` chunk starts the
  model over from the rebuilt context. If the work isn't expressed as resumable
  progress, the model frequently re-reasons about and re-issues steps it already
  attempted in the previous chunk instead of advancing. Successive chunks burn
  their entire 40s budget re-deciding rather than completing new steps.
- **Partial or zero net progress.** Because each chunk can be cut mid-step and
  the next chunk may redo earlier steps, the run can churn for many chunks while
  the _persisted_ end state barely moves — or, when nothing reaches a committed
  state before each cutoff, moves not at all.
- **Silent "looked-done" failure.** A tool call that returned a success marker
  (✓) in an aborted chunk does not guarantee its effect was committed and
  survived the cutoff. The model can reasonably believe a step succeeded, report
  the whole task complete, and leave nothing (or only some rows) actually
  persisted. The user is told it worked; the data says otherwise.

Net effect: long multi-step runs can spin indefinitely, never finish, and
terminate with an untruthful "done" state.

## Goals

1. Long multi-step runs **complete reliably** — they make monotonic forward
   progress across continuation chunks rather than re-doing work.
2. The user always gets a **truthful terminal state**: either "completed, here
   is concrete proof (N of N persisted, ids …)", or an honest "did not finish,
   here is what was committed (M of N) and what remains" — never a false
   success.
3. No change to the upstream walls and no raising of the 40s soft timeout (see
   Guardrail).

## Non-goals

- Raising or removing the soft timeout. It is correct; see Guardrail.
- Changing the gateway, serverless function limits, or model call timeout.
- Replacing `auto_continue`. Both approaches below build on it.

## Guardrail: the 40s soft timeout is correct and must not be raised

`DEFAULT_HOSTED_RUN_SOFT_TIMEOUT_MS` / `HOSTED_SOFT_TIMEOUT_CEILING_MS` =
`40_000` is intentional headroom under the upstream hard walls. Raising it does
not buy more time — it just converts a graceful hand-off into a hard kill. The
walls, in order:

1. **Builder model gateway hard cap — ~45s.**
   `MAX_BUILDER_GATEWAY_TIMEOUT_MS = 45_000` in
   `packages/core/src/agent/engine/builder-engine.ts`. A single model call is
   killed at the gateway after 45s. **Not raisable** by the framework.
2. **Serverless function kill — ~60–65s.** The hosting function is terminated
   shortly after; the heartbeat then reaps the run row as `stale_run`.

40s leaves ~5s under the gateway wall to abort, persist the partial turn, write
the terminal event, and emit a clean `auto_continue` so the client resumes. A
larger value (production saw per-template overrides like `240_000`) pushes the
cutoff past both walls, so `auto_continue` never fires and the run dies as
`builder_gateway_timeout` / `stale_run` instead. The ceiling clamp in
`resolveRunSoftTimeoutMs` exists precisely to defeat that footgun. **Do not
raise it. Fix durability above the timeout, not by moving the timeout.**

## Approach options

Both options keep the 40s budget and build on the existing `auto_continue`
mechanism. They differ in _where the long work lives_.

### Option A — Checkpointed / idempotent continuation

Keep the work inside the normal run/`auto_continue` loop, but make each
continuation chunk **resume from committed progress instead of restarting**.

Mechanism:

- **Persist a progress record** for the operation (a checkpoint): the planned
  unit of work (the N items / steps), and which units are already committed.
  This lives in SQL so it survives chunk boundaries and function recycling, the
  same way run rows do.
- **Idempotent steps.** Each step keys off a stable identity so re-issuing a
  completed step is a no-op (upsert by natural key, or "skip if checkpoint says
  done"). Re-hydration after `auto_continue` then can't double-apply or
  thrash — a redone step costs a cheap check, not a duplicate write.
- **Resume, don't replan.** On `auto_continue`, the next chunk reads the
  checkpoint, skips committed units, and continues with the remainder. Progress
  is monotonic: every chunk that does anything moves the committed count up.
- **Truthful terminal state from the checkpoint.** "Done" means the checkpoint
  shows N of N committed. If the run is cut for good (e.g. it exhausts a
  continuation budget), the checkpoint still reports M of N committed and the
  exact remainder — so the terminal message is honest by construction.

Interaction with the walls and the 40s budget:

- Fully respects the 40s soft timeout and the gateway/function walls — it never
  needs a single chunk to outlast them. It just makes the _sequence_ of chunks
  productive.
- Works hand-in-glove with `auto_continue`: today a continuation can redo work;
  with a checkpoint, a continuation can only advance.

Tradeoffs:

- Pro: smallest change to the runtime model; no new infrastructure; the user
  keeps watching one live turn; degrades gracefully (even a half-finished run is
  truthful and re-runnable).
- Pro: directly kills re-hydration thrash, the actual failure mode.
- Con: still bounded by however many continuation chunks the client/turn budget
  allows. A truly enormous job (thousands of steps) can still run out of chunks
  — but it now ends _truthfully partial and resumable_, not silently empty.
- Con: requires per-operation work to define the unit of progress and make
  steps idempotent. Best paid down once at the primitive/action layer (see
  Tie-in) so individual agents don't have to.

### Option B — Out-of-band durable background execution

Hand a long run to a **queued background job** that executes beyond the
function/gateway lifetime and reports progress back into the run/event stream.

Mechanism:

- The foreground turn **enqueues** a durable job (the full operation + its
  inputs) and returns immediately with "started, tracking as job X". The
  user-facing run does not try to do the work itself within 40s.
- A durable worker (outside the per-request serverless function lifetime — e.g.
  the core run-manager / agent-teams background infrastructure the framework
  already mandates for background agents) runs the job to completion, free of
  the 45s gateway cap and the ~60s function kill on the _original_ request.
- The worker **streams progress** (committed counts, ids, errors) back so the
  UI and the agent can observe and the final state is truthful.

Interaction with the walls and the 40s budget:

- Sidesteps the gateway/function walls for the _long_ work by moving it off the
  request path. The walls still apply to each individual model call the worker
  makes, so the worker itself should checkpoint internally (i.e. Option B is
  strongest when it contains Option A).
- `auto_continue` becomes a lightweight "is the job still running / what's its
  progress" poll on the foreground turn rather than the vehicle for the work.

Tradeoffs:

- Pro: removes the hard ceiling on total operation length — genuinely large
  jobs can finish.
- Pro: the foreground turn stays responsive and cheap; the user can leave and
  come back.
- Con: more infrastructure and lifecycle complexity (job queue, durable worker,
  progress fan-in, failure/retry semantics, surfacing job state in the UI and
  to the agent).
- Con: changes the UX from "one live turn" to "fire-and-track"; needs clear
  status surfacing so it doesn't become its own kind of silent failure.

## Recommendation

Build **Option A first**, then layer **Option B** for the genuinely unbounded
cases. Option A delivers the most reliability per unit of effort: it directly
removes re-hydration thrash and silent looked-done failure for the common case
(tens of steps), needs no new infrastructure, and makes terminal state truthful
by construction. Option B is the right ceiling-remover but is a larger build and
is most valuable _on top of_ a checkpointed core (the durable worker should
itself checkpoint).

### Phased plan

1. **Phase 0 — Stop hitting the ceiling so often (near-term, cheapest).** Land
   the mitigations in the Tie-in below (one-call atomic primitives,
   self-documenting actions, loud termination, proof-of-done verification).
   These don't fix the ceiling but sharply cut how often multi-step loops are
   even attempted, and make the failures that remain _loud and truthful_ instead
   of silent. Capture the agent-facing half as the `reliable-mutations` skill.
2. **Phase 1 — Checkpointed continuation (Option A).** Add a SQL-backed progress
   checkpoint for long operations and make their steps idempotent/resumable so
   each `auto_continue` chunk advances committed progress instead of replanning.
   Drive terminal state ("N of N", or "M of N + remainder") from the checkpoint.
   This is the primary reliability win.
3. **Phase 2 — Durable background execution (Option B).** For operations that
   can exceed any reasonable number of continuation chunks, enqueue them onto the
   core background infrastructure, have the durable worker run them to completion
   (checkpointing internally per Phase 1), and stream truthful progress back to
   the foreground run and UI.

## Tie-in: cheaper near-term mitigations reduce, but do not replace, the fix

The following reduce _how often_ the 40s ceiling is hit and make the remaining
failures honest. They are valuable and should ship first (Phase 0), but the
**actual fix is durable/checkpointed runs** (Phases 1–2):

- **One-call atomic primitives.** Where an action can accept the whole batch
  (e.g. "set all panels" / "append many in one call"), a single call commits
  atomically inside one chunk instead of looping N writes that race the budget.
- **Self-documenting actions.** Action descriptions that steer agents toward the
  atomic/batch call and away from per-item loops.
- **Loud termination.** On a time-budget cutoff, fail loud with what was and
  wasn't committed — never report success on an aborted chunk.
- **Proof-of-done verification.** After a write, re-read the end state and report
  concrete proof (counts/ids) rather than trusting a tool ✓.

The agent-facing rules for these live in the `reliable-mutations` skill
(`.agents/skills/reliable-mutations/SKILL.md`). They lower the blast radius;
checkpointed and durable runs remove the ceiling itself.
