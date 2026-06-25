# Design: Durable / Checkpointed Agent Runs

Status: Phase 1 + Phase 2 implemented (flagged, off by default); Phase 0 shipped;
internal per-step checkpointing (Option A core) still recommended-not-built.
Owner: core / run-manager + deploy
Related code: `packages/core/src/agent/run-manager.ts`,
`packages/core/src/agent/durable-background.ts`,
`packages/core/src/agent/production-agent.ts`,
`packages/core/src/server/agent-chat-plugin.ts`,
`packages/core/src/deploy/build.ts`,
`packages/core/src/deploy/workspace-deploy.ts`,
`packages/core/src/agent/engine/builder-engine.ts`

> **Final architecture, in one line.** Durable background runs are a
> **host-agnostic core** — the foreground turn fires an HMAC-signed _self
> dispatch_ to a sibling worker route, the worker runs the full multi-step loop
> and persists every event to SQL, and the browser streams those events through
> the existing cross-isolate SQL-poll reconnect path — with the **Netlify 15-min
> `-background` function as a per-host optimization** layered on top. The
> portable baseline works on any host that can re-invoke itself (it just
> server-chains continuations when the host budget is short); the Netlify layer
> simply lets one invocation run ~15 min so a long turn finishes in **one**
> chunk instead of many re-hydrating ones. Nothing about the baseline is
> Netlify-specific; see [Final layered architecture](#final-layered-architecture).

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

> Status: **Phase 0 shipped. Phase 1 + Phase 2 implemented** (the host-agnostic
> durable-background worker and the Netlify 15-min `-background` optimization),
> behind `AGENT_CHAT_DURABLE_BACKGROUND`, off by default. Internal per-step
> checkpointing (the Option A core of Phase 1) is recommended-not-yet-built; the
> worker today gets its durability from the long single invocation plus
> server-chained continuations rather than per-step idempotent checkpoints. See
> [Final layered architecture](#final-layered-architecture).

1. **Phase 0 — Stop hitting the ceiling so often (near-term, cheapest).** Land
   the mitigations in the Tie-in below (one-call atomic primitives,
   self-documenting actions, loud termination, proof-of-done verification).
   These don't fix the ceiling but sharply cut how often multi-step loops are
   even attempted, and make the failures that remain _loud and truthful_ instead
   of silent. Capture the agent-facing half as the `reliable-mutations` skill.
   _(Shipped.)_
2. **Phase 1 — Checkpointed continuation (Option A).** Add a SQL-backed progress
   checkpoint for long operations and make their steps idempotent/resumable so
   each `auto_continue` chunk advances committed progress instead of replanning.
   Drive terminal state ("N of N", or "M of N + remainder") from the checkpoint.
   This is the primary reliability win. _(The durable-background worker +
   host-agnostic self-dispatch/SQL-event/reconnect baseline is implemented;
   per-step idempotent checkpointing is still recommended-not-built.)_
3. **Phase 2 — Durable background execution (Option B).** For operations that
   can exceed any reasonable number of continuation chunks, enqueue them onto the
   core background infrastructure, have the durable worker run them to completion
   (checkpointing internally per Phase 1), and stream truthful progress back to
   the foreground run and UI. _(Implemented: host-agnostic worker baseline +
   Netlify 15-min `-background` per-host optimization, flagged off by default.)_

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

---

# Final layered architecture

Status: implemented (flagged, off by default)
Owner: core / run-manager + deploy

Durable background runs ship as **two layers**. Both are gated behind
`AGENT_CHAT_DURABLE_BACKGROUND` and default off; when off, the agent-chat run
path and the deploy output are byte-for-byte the pre-existing synchronous
behavior.

### Layer 1 (portable baseline) — host-agnostic durable execution

This is the actual durability mechanism and it is **not tied to any host**:

- **Self-dispatch worker.** The foreground POST claims the run slot, inserts the
  run row, and `fireInternalDispatch`es (`server/self-dispatch.ts`) an
  HMAC-signed request to a sibling worker route,
  `AGENT_CHAT_PROCESS_RUN_PATH = /_agent-native/agent-chat/_process-run`
  (`agent/durable-background.ts`). The worker re-enters the same agent-chat
  handler set as the background worker and runs the full multi-step
  `runAgentLoop` (`agent/production-agent.ts`).
- **SQL event log as the transport.** The worker persists every event to
  `agent_run_events` (`run-store.ts`, idempotent on `(run_id, seq)`). The
  browser streams those events through the existing `subscribeToRun` →
  cross-isolate SQL-poll path (`run-manager.ts subscribeFromSQL`), so the client
  needs no change and reconnect/leave-and-return already works
  (`GET /runs/active`, `GET /runs/:id/events?after=N`).
- **Idempotent claim + auth.** The worker claims the run with a conditional
  update (`claimBackgroundRun`) so a duplicate delivery no-ops, and verifies the
  HMAC token (`prepareProcessRunRequest`) exactly like the agent-teams / A2A /
  webhook processors.
- **Continuation by self-chaining, not by the browser.** If a worker chunk hits
  its soft-timeout unfinished, it emits `auto_continue` and **re-fires another
  background dispatch** (mode `continue`) instead of bouncing back to the client.
  On a host with a short invocation budget this just produces more chunks; the
  run still completes, server-driven. This is what makes the baseline portable:
  it degrades to chained self-dispatch on any host that can re-invoke itself.

Nothing in Layer 1 assumes Netlify, a 15-minute budget, or a particular preset.
It is the host-agnostic Option B worker with a SQL fan-in.

### Layer 2 (per-host optimization) — Netlify 15-min `-background` function

On Netlify, Layer 1's worker invocation can be made to run for up to **15
minutes** in a single shot, eliminating almost all re-hydration (the costly
part). This is purely an optimization of _where_ Layer 1's worker runs:

- **Deploy emit (build-time gated).** When the flag is set at build time, the
  deploy emits a **second** Netlify function whose name ends in `-background`,
  re-exporting the **same** `main.mjs` handler bundle, with a `config.path` of
  the process-run route. Netlify invokes any function whose deployed name ends in
  `-background` asynchronously (202 immediately, up to 15-min budget). Single
  template: `emitSingleTemplateNetlifyBackgroundFunction` (`deploy/build.ts`).
  Workspace: `emitNetlifyBackgroundFunction` (`deploy/workspace-deploy.ts`),
  per app with a base-path-scoped `config.path`. **When the flag is not set at
  build time, neither emit runs and the single-function output is byte-identical
  to today** (see [Build-time gate](#build-time-gate-byte-identical-when-off)).
- **Raised soft-timeout on that invocation only.** When the worker is running
  inside the background function it calls
  `startRun(..., { backgroundFunction: true })`, which lifts
  `resolveRunSoftTimeoutMs`'s hosted ceiling from 40s to
  `BACKGROUND_SOFT_TIMEOUT_CEILING_MS` (~13 min, ~2 min under Netlify's 15-min
  hard kill) for that invocation. The interactive/foreground 40s clamp is
  unchanged (see Guardrail).

If Layer 2 is absent (or its routing resolves to the synchronous function),
Layer 1 still works — the run just completes via more, shorter, server-chained
chunks. **No regression, only a missed optimization.**

### Other hosts

Any host that can re-invoke itself runs Layer 1 unchanged (chained
self-dispatch). A host-specific Layer 2 would mirror the Netlify pattern: emit
or configure a long-lived async worker invocation and pass
`backgroundFunction: true` to `startRun` on that path. No such layer is built for
non-Netlify hosts yet; they get the portable baseline.

## Build-time gate (byte-identical when off)

The safety-critical claim is that with `AGENT_CHAT_DURABLE_BACKGROUND` **unset at
build time**, the emitted Netlify deploy output is unchanged. How it is
guaranteed:

- The only code that produces the `-background` artifact is the two emit
  functions above, and each is reached **only** through a call site guarded by
  `isDurableBackgroundDeployEnabled()` (single template: `deploy/build.ts`,
  inside the `preset === "netlify"` block; workspace:
  `deploy/workspace-deploy.ts`, inside `copyNetlifyFunctionIntoWorkspace`).
  `isDurableBackgroundDeployEnabled()` returns `false` for an unset or
  non-truthy flag, so when the flag is absent the emit functions are **never
  invoked** — no second function directory, no extra entry file, no extra
  `config.path` route is written. The deploy walks exactly the same code path it
  does today and emits exactly one function per app.
- The gate reads the flag at **build time** (in the deploy process env), so a
  build produced without the flag can never contain the artifact regardless of
  runtime env.
- This is covered by tests that run the real deploy path with the flag unset and
  assert that no `*-agent-background` directory exists, and with the flag set and
  assert that exactly one does (`deploy/workspace-deploy.spec.ts`,
  `deploy/build.spec.ts`).

---

# Netlify Layer 2: concrete implementation notes

This section details the Netlify-specific Layer 2 optimization (the deploy emit
and the 15-min budget), reusing the framework's existing background-run
machinery and Netlify's **background functions** (async, up to **15 minutes**).
It is deliberately not a from-scratch system: ~90% of the required plumbing
already ships for Agent Teams, A2A, and integration webhooks — and the
host-agnostic Layer 1 above is what actually carries the run.

## Why a 15-min background invocation changes the math

The whole `auto_continue` / 40s soft-timeout dance exists to stay under the
**serverless function wall** (~60–65s synchronous on Netlify), not under any
model limit. Evidence:

- `builder-engine.ts:62` `MAX_LOCAL_BUILDER_GATEWAY_TIMEOUT_MS = 180_000`
  (3 min) is allowed locally; the run loop has no inherent reason to stop at 40s.
- `run-manager.ts:58,68` `DEFAULT_HOSTED_RUN_SOFT_TIMEOUT_MS` /
  `HOSTED_SOFT_TIMEOUT_CEILING_MS = 40_000` are pinned just under the function
  wall, and `templates/brain/netlify.toml` sets `[functions."*"] timeout = 75`.

Netlify **background functions** (any function whose deployed name ends in
`-background`) are invoked asynchronously: the HTTP POST returns `202 Accepted`
immediately and the function runs detached for up to **15 minutes**. Inside that
function there is no ~60s wall, so:

- The agent loop can run for minutes in a single invocation with **few or no
  `auto_continue` continuations**.
- The per-model-call gateway cap (`MAX_BUILDER_GATEWAY_TIMEOUT_MS = 45_000`,
  `builder-engine.ts:60`) still applies per call — see
  [Per-model-call gateway cap](#per-model-call-gateway-cap) — but the _run_ is no
  longer chopped into 40s chunks.

This is exactly the Layer 1 worker with a concrete long-lived host: Netlify is
the durable worker, reached through the existing self-dispatch primitive — the
same primitive that, absent this layer, just chains shorter invocations.

## What already exists and is reused verbatim

The Agent Teams background processor is the template. The chat path can reuse
nearly all of it:

| Capability                                                           | Existing code                                                                                                                                                                                                 | Reuse for chat                                                                                                                                                                         |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Fire a fresh function invocation with its own budget                 | `server/self-dispatch.ts:122` `fireInternalDispatch()` (HMAC-signed POST, 250ms settle race)                                                                                                                  | Point it at the `-background` function path instead of the same-function processor route                                                                                               |
| Processor route pattern (claim → run full loop → persist → finalize) | `agent-teams.ts` `processAgentTeamRun()` + route at `agent-chat-plugin.ts:6001` (`AGENT_TEAM_PROCESS_RUN_PATH = /_agent-native/agent-teams/_process-run`)                                                     | Add a sibling `/_agent-native/agent-chat/_process-run` that runs the **chat** loop                                                                                                     |
| HMAC processor auth                                                  | `integrations/internal-token.ts:61,72` `signInternalToken` / `verifyInternalToken` (5-min TTL, task-id-bound, timing-safe); gated by `A2A_SECRET`                                                             | Same — sign with `runId`                                                                                                                                                               |
| Atomic single-claim (no double-processing)                           | `agent-teams-run-queue.ts:177` `claimAgentTeamRun()` (`UPDATE … WHERE status='queued' OR (status='running' AND updated_at < stuckCutoff)`)                                                                    | Same shape; the chat already has an equivalent with `updateRunStatusIfRunning()` (`run-store.ts:392`, `UPDATE … WHERE id=? AND status='running'`) and `tryClaimRunSlot(threadId)`      |
| The actual multi-step agent loop                                     | `runAgentLoop()` (imported into both `production-agent.ts` and `agent-teams.ts:1790`)                                                                                                                         | Identical — call it from the background processor                                                                                                                                      |
| Event persistence (SQL, ordered, idempotent)                         | `run-store.ts`: `insertRunEvent(runId, seq, json)` with `ON CONFLICT (run_id, seq) DO NOTHING` (`:452,466`); `getRunEventsSince(runId, fromSeq)` (`:471`)                                                     | Unchanged — background worker writes the same `agent_run_events` rows                                                                                                                  |
| Client reconnect / replay by cursor                                  | `agent-chat-plugin.ts:7103` `GET /runs/:id/events?after=N` → `subscribeToRun(runId, after)`; cross-isolate SQL polling path `run-manager.ts:750` `subscribeFromSQL()` (polls `getRunEventsSince` every 500ms) | **This is the key reuse**: the background worker is a different isolate, so the client already falls through to the SQL-polling subscription. Reconnect already works across isolates. |
| Discover an in-flight run on reload                                  | `agent-chat-plugin.ts:7130` `GET /runs/active?threadId=X` (returns `runId`, `turnId`, `status`, `heartbeatAt`, `lastProgressAt`, `serverNow`)                                                                 | Unchanged                                                                                                                                                                              |
| Heartbeat + stale reaper                                             | `run-manager.ts:340` (1.5s heartbeat), `run-store.ts:19` `RUN_STALE_MS = 15_000`, `reapIfStale` / `reapAllStaleRuns`                                                                                          | Reused; see [Failure handling](#failure-handling-and-loud-terminal-state) for the 15s-vs-15min tension                                                                                 |
| Stuck-dispatch re-fire / reconcile                                   | `agent-teams.ts:689` refire, `reconcileAgentTeamRunsForOwner` (`:797`)                                                                                                                                        | Optional reuse for chat reconcile                                                                                                                                                      |

The single genuinely **new** infrastructure piece is **deploy-time function
splitting**: today the Nitro `netlify` preset emits exactly one function
(`.netlify/functions-internal/server/` → `server.mjs` re-exporting `main.mjs`,
patched in `workspace-deploy.ts:670` `patchNetlifyFunctionEntry`; routed via the
`config.path` array at `:742`). We must additionally emit a second function whose
name ends in `-background` that re-exports the **same** `main.mjs` handler.

## The dispatch flow (designed)

```
┌── Browser ─────────────────────────────────────────────────────────────┐
│ 1. POST /_agent-native/agent-chat  { message, threadId, turnId }        │
└────────────────────────────────────────────────────────────────────────┘
                 │  (foreground function: the normal interactive handler)
                 ▼
┌── agent-chat handler (production-agent.ts) ────────────────────────────┐
│ 2. tryClaimRunSlot(threadId)  → 409 if a run is already active          │
│ 3. runId = generateRunId(); insertRun(runId, threadId, turnId)         │
│    (status='running', heartbeat set) — run-store.ts:233                 │
│ 4. IF durable-background enabled (hosted + flag + A2A_SECRET):          │
│       fireInternalDispatch({                                            │
│         path: BACKGROUND_FUNCTION_INVOKE_PATH,   // 202, detached       │
│         taskId: runId, body: { threadId, turnId, message, … } })       │
│       return SSE stream = subscribeToRun(runId, 0)  // immediately      │
│    ELSE (local / flag off):                                             │
│       startRun(runId, …) inline  (today's behavior, unchanged)          │
└────────────────────────────────────────────────────────────────────────┘
                 │ 202 leaves the box (250ms settle race)
                 ▼
┌── Netlify background function  (…-background, up to 15 min) ───────────┐
│ 5. Route: POST /_agent-native/agent-chat/_process-run                   │
│ 6. verifyInternalToken(runId, bearer)        // internal-token.ts:72    │
│ 7. atomically claim runId (updateRunStatusIfRunning-style guard)        │
│ 8. raise gateway cap for this invocation (see §gateway-cap)            │
│ 9. startRun(runId, …, { softTimeoutMs: 0 OR ~13min })                   │
│    → runAgentLoop(...) runs the FULL multi-step turn                    │
│    → emitRunEvent(...) persists every event to agent_run_events (SQL)   │
│ 10. on finish: updateRunStatusIfRunning(runId,'completed'|'errored')    │
│     + terminal event ('done'/'error') persisted                        │
└────────────────────────────────────────────────────────────────────────┘
                 ▲ writes SQL events
                 │ reads SQL events (cross-isolate)
┌── Browser (same SSE response from step 4, OR reconnect) ──────────────┐
│ 11. The SSE stream is subscribeToRun(runId,0). Because the producer is │
│     a *different* isolate, it serves via subscribeFromSQL() —           │
│     run-manager.ts:750 — polling getRunEventsSince every 500ms.         │
│ 12. On disconnect/reload: GET /runs/active?threadId → runId+lastSeq,    │
│     then GET /runs/:id/events?after=lastSeq resumes the same stream.    │
└────────────────────────────────────────────────────────────────────────┘
```

### Endpoints / constants to add

- `BACKGROUND_FUNCTION_INVOKE_PATH` — the Netlify async path,
  `/.netlify/functions/<app>-agent-background` (Netlify maps `…-background` to
  async/202). The dispatch URL is built with `resolveSelfDispatchBaseUrl(event)`
  (`self-dispatch.ts:59`) + that path. (Alternatively, give the background
  function a `config.path` like `/_agent-native/_bg/*` so dispatch stays a clean
  framework path and Netlify still routes it to the `-background` function and
  invokes it async.)
- `AGENT_CHAT_PROCESS_RUN_PATH = "/_agent-native/agent-chat/_process-run"` — the
  handler the background function actually runs (sibling to
  `AGENT_TEAM_PROCESS_RUN_PATH`). It is reached _through_ the background
  function, so it inherits the 15-min budget.
- Feature flag: `AGENT_CHAT_DURABLE_BACKGROUND` (env or per-app config),
  defaulting **off**, gated additionally on `isHostedRuntime()` and
  `hasConfiguredA2ASecret()`. Local dev keeps the inline path so SSE stays a
  single live stream and no second function is needed.

## Where the soft-timeout / auto_continue logic changes

Today (`run-manager.ts:344`) every hosted run gets a 40s soft timeout that emits
`auto_continue` and the client re-POSTs. In the background-function path:

- **The background `startRun` gets `softTimeoutMs` ≈ 13 min** (a margin under
  Netlify's 15-min hard kill), not 40s. To allow this, `resolveRunSoftTimeoutMs`
  must learn a **background context**: the `HOSTED_SOFT_TIMEOUT_CEILING_MS = 40_000`
  clamp (`run-manager.ts:170`) currently _defeats_ any larger value on hosted.
  Add a `backgroundFunction: true` option that raises the ceiling to ~`780_000`
  (13 min) for that one invocation. **Do not** change the default hosted ceiling
  — the 40s clamp stays correct for the interactive/foreground path; the
  Guardrail above still holds for non-background runs.
- **`auto_continue` becomes the rare exception, not the rule.** Most turns finish
  inside 13 min with zero continuations, killing the re-hydration thrash
  described in the Problem section. If a turn _does_ exceed 13 min, the existing
  mechanism still works: emit `auto_continue` and re-fire **another background
  dispatch** (mode `continue`) exactly as `agent-teams.ts:1886` does — i.e. the
  continuation chains background invocations instead of bouncing back to the
  browser. The client never has to drive continuation.
- **Internally, the worker should still checkpoint (Option A).** 15 min is large
  but not infinite; combining background execution with idempotent/checkpointed
  steps means even a continued run advances monotonically. Option B is strongest
  containing Option A.

## How the client UX changes (SSE → SSE-over-SQL + reconnect)

Minimal client change, because the reconnect machinery already exists:

- **The response shape is unchanged.** Step 4 still returns an SSE
  `ReadableStream` from `subscribeToRun(runId, 0)`. The client keeps reading SSE
  exactly as today. The only difference is that the events are produced in
  another isolate and arrive via the 500ms SQL-poll path
  (`subscribeFromSQL`, `run-manager.ts:750`) instead of the in-memory fast path.
  Latency goes from ~instant to ≤500ms per event — acceptable for chat.
- **Reconnect/leave-and-return becomes a first-class, reliable flow.** Because
  the producer is detached on Netlify, closing the tab no longer kills the run.
  On return, the client calls `GET /runs/active?threadId` (`:7130`) → gets
  `runId` + status, then `GET /runs/:id/events?after=<lastSeq>` (`:7103`) to
  replay from the cursor. This already works; we are just making it the primary
  UX. Recommend the client persist `lastSeq` per thread so reconnect resumes
  precisely.
- **Optional: drop the long-held foreground SSE entirely and poll.** Instead of
  holding step-4's SSE open against the 75s foreground-function `timeout`
  (`netlify.toml`), the foreground POST can return `{ runId, turnId }` (202-style
  JSON) and the client immediately opens `GET /runs/:id/events?after=0`. This
  avoids tying up a foreground function for the run's lifetime. Either works;
  the JSON-then-poll variant is cleaner on Netlify because the interactive
  function returns in well under 75s.

## Per-model-call gateway cap

Even in a 15-min function, a _single_ model call is still capped by the Builder
gateway: `MAX_BUILDER_GATEWAY_TIMEOUT_MS = 45_000` (`builder-engine.ts:60`),
resolved by `getBuilderGatewayTimeoutMs()` (`:770`) /
`resolveMaxBuilderGatewayTimeoutMs()` (`:758`). Locally the cap is already
`180_000` (`:62`) when the gateway base URL is localhost.

Options, in scope-order:

1. **In scope / safe now:** keep the 45s per-call cap. A 15-min function makes
   _many_ 45s calls; the cap bounds one call, not the run. This alone delivers
   the goal (long multi-step runs finish) with **zero gateway changes**.
2. **Flag, out of scope until confirmed:** raise the per-call cap toward 180s in
   the background context. `getBuilderGatewayTimeoutMs()` already honors
   `AGENT_NATIVE_BUILDER_GATEWAY_TIMEOUT_MS`, but it is hard-clamped to
   `resolveMaxBuilderGatewayTimeoutMs()` = 45s for non-localhost gateways. Raising
   it requires the **hosted Builder gateway to actually allow >45s upstream** —
   unverified, and not the framework's call. Until confirmed, do not raise it.
3. **Escape hatch:** a direct Anthropic engine (no Builder gateway) has no 45s
   cap, so a single very long call could use it. Out of scope for this change;
   note it as the lever if a single model call truly needs >45s.

**Recommendation:** ship with option 1. The win is removing the _run-level_
ceiling; the per-call cap is orthogonal and rarely the binding constraint.

## Idempotency / dedup

Already strong; make the new claim match:

- **Run claim.** The foreground inserts the run row (`insertRun`,
  `run-store.ts:233`) _before_ dispatching. The background processor must claim
  it with a conditional update (mirror `updateRunStatusIfRunning`,
  `run-store.ts:392`, or add a `claimRunForProcessing(runId)` that flips a
  `processing` marker only from the unclaimed state). A duplicate Netlify
  delivery (background functions can in theory be retried) then no-ops on the
  second claim, exactly like `claimAgentTeamRun` returning `null`
  (`agent-teams-run-queue.ts:177`).
- **Event dedup.** `insertRunEvent` is already idempotent on `(run_id, seq)`
  via `ON CONFLICT … DO NOTHING` (`run-store.ts:452,466`). Re-emitting an event
  with the same seq is a safe no-op, so a retried/overlapping producer cannot
  duplicate the stream.
- **Dispatch token.** `fireInternalDispatch` signs `runId`
  (`self-dispatch.ts:131`); the processor verifies it (`internal-token.ts:72`,
  5-min TTL). A stale or forged dispatch is rejected.

## Failure handling and loud terminal state

- **15s heartbeat vs 15-min runs — the one real conflict.** The stale reaper
  (`RUN_STALE_MS = 15_000`, `run-store.ts:19`; `reapIfStale`/`reapAllStaleRuns`)
  marks a run `errored` after 15s without a heartbeat. The background worker
  _does_ run `startRun`'s 1.5s heartbeat (`run-manager.ts:340`), so as long as
  the worker is alive the row stays fresh and the reaper leaves it alone — this
  is fine. The risk is a worker that is _slow to start_ (Netlify cold-start of
  the background function) leaving a freshly-inserted `running` row unheartbeaten
  for >15s, which the reaper would falsely kill. Mitigation: the foreground
  insert sets `heartbeat_at = now` (`insertRun`), and the background claim should
  bump the heartbeat immediately on entry; if cold starts can exceed 15s, widen
  `RUN_STALE_MS` for rows known to be background-dispatched (e.g. a
  `dispatch_mode` column or a separate, larger stale window for background runs).
- **Worker dies mid-run (crash / 15-min kill).** Heartbeat stops, the reaper
  flips the row to `errored` and appends a synthetic terminal event
  (`reapIfStale`), so the client's SQL-poll subscription sees a terminal event
  and stops — no infinite spinner. This is the **loud terminal** contract from
  Phase 0 already wired.
- **Dispatch never lands (202 lost).** Reuse the Agent-Teams reconcile pattern
  (`reconcileAgentTeamRunsForOwner`, `agent-teams.ts:797`): if a `running` row
  has no heartbeat after a grace window, re-fire the dispatch once, then fail
  loud. Optional for the first slice.
- **Truthful terminal state.** Combined with the `reliable-mutations` Phase-0
  proof-of-done discipline, a completed background run reports concrete proof;
  a killed one reports `errored` with what was committed — never a false success.

## Phased implementation plan (smallest working slice first)

> Status: \*\*Slices 0–1 implemented and the Slice-3 background-aware stale window
>
> - background→background continuation chaining are implemented\*\*, all behind
>   `AGENT_CHAT_DURABLE_BACKGROUND` (off by default). The host-agnostic baseline
>   (Layer 1) carries the run on any host; the Netlify `-background` emit (Layer 2)
>   is the deploy-time optimization. Slice 2's richer reconnect-first client UX and
>   the internal per-step checkpointing (Option A) remain follow-ups; Slice 4
>   (raising the per-call gateway cap) is intentionally out of scope (see
>   [Per-model-call gateway cap](#per-model-call-gateway-cap)).

**Slice 0 — prove async dispatch on Netlify (no chat yet).**
Emit one extra `-background` function in the deploy build that re-exports the
existing `main.mjs` handler (extend `patchNetlifyFunctionEntry`,
`workspace-deploy.ts:670`, and the single-template Netlify output in
`deploy/build.ts:1935`). Add `AGENT_CHAT_PROCESS_RUN_PATH` returning a stub that
just writes a run event. Dispatch to it from a temporary test route via
`fireInternalDispatch`. **Done when:** a POST returns 202 immediately and the
stub writes an event to `agent_run_events` from the background function, visible
via `GET /runs/:id/events`. This de-risks the only genuinely new infra.

**Slice 1 — route the real chat loop through the background function (flagged).**
Behind `AGENT_CHAT_DURABLE_BACKGROUND` (off by default; hosted + `A2A_SECRET`
only): foreground handler inserts the run row, dispatches, returns the SSE
stream from `subscribeToRun`. The background `_process-run` claims the run and
calls the same `startRun` + `runAgentLoop` the inline path uses, with
`softTimeoutMs ≈ 13min` (new `backgroundFunction` option in
`resolveRunSoftTimeoutMs`). Per-call gateway cap stays at 45s (option 1).
**Done when:** a long multi-step turn that thrashes today completes in one
background invocation with zero `auto_continue`, events streaming to the client
via the SQL-poll path, terminal `done` persisted.

**Slice 2 — reconnect/leave-and-return UX.**
Make the client persist `lastSeq` per thread and, on load, use
`/runs/active` + `/runs/:id/events?after=lastSeq` as the primary resume path.
Optionally switch the foreground POST to return `{ runId, turnId }` JSON instead
of holding SSE, then poll. **Done when:** closing/reopening the tab mid-run
resumes the live stream with no lost or duplicated events.

**Slice 3 — robustness.**
Background-aware stale window (cold-start tolerance), reconcile/re-fire for lost
dispatches, and background→background `auto_continue` chaining for the rare

> 13-min turn (mirror `agent-teams.ts:1886`). Internal checkpointing (Option A)
> for monotonic progress across any continuation.

**Slice 4 (optional, separate decision) — raise the per-call gateway cap.**
Only after confirming the hosted Builder gateway accepts >45s upstream; wire
`AGENT_NATIVE_BUILDER_GATEWAY_TIMEOUT_MS` through with a background-context max.
Out of scope until that confirmation exists.

## Open risks / unknowns

1. **Netlify background-function invocation contract.** Confirm the exact
   trigger: name-suffix `-background` invoked at `/.netlify/functions/<name>`
   returning 202, and whether a `config.path` route can also mark a function
   background. The deploy currently emits a single function — splitting it is the
   main new work and must not regress the existing `config.path` routing
   (`workspace-deploy.ts:742`).
2. **Cold-start vs 15s stale reaper** (detailed above) — the highest-likelihood
   false-failure; needs the background-aware stale window or an on-entry
   heartbeat bump.
3. **Hosted gateway >45s** — unknown whether upstream allows it; gates Slice 4.
4. **Two functions sharing one bundle** — both re-export the same `main.mjs`, so
   `includedFiles: ["**"]` (`workspace-deploy.ts:747`) must cover the background
   function dir too; verify bundle size and that env (`A2A_SECRET`, DB URL) is
   present in the background function's environment.
5. **Cost / concurrency** — background functions are billed and concurrency-
   limited differently; long runs hold a slot for minutes. Out of scope to
   solve, but flag for capacity planning.
