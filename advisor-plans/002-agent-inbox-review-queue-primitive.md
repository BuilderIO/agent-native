# Plan 002: Design the shared review-queue primitive ("agent inbox") by generalizing Dispatch approvals

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `advisor-plans/README.md` — unless a reviewer dispatched you and told you
> they maintain the index.
>
> **Drift check (run first)**: `git diff --stat f1c6e017bc..HEAD -- packages/dispatch/src/actions packages/dispatch/src/routes/pages packages/core/docs/content/human-approval.mdx packages/core/src/audit packages/toolkit/src`
> If any in-scope-for-reading file changed since this plan was written,
> compare the "Current state" excerpts against the live code before
> proceeding; on a mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M (this design spike; the implementation it specifies is L)
- **Risk**: LOW — read-only investigation producing a design document
- **Depends on**: none (pairs with `advisor-plans/001-one-click-templates-restore-vs-rebuild.md`; read its report first if it exists)
- **Category**: direction (design/spike)
- **Planned at**: commit `f1c6e017bc`, 2026-07-10

## Why this matters

The active product direction (2026-07-09) for "one-click agent" templates
names its differentiator explicitly: incumbents' (Zapier/n8n/Lindy) top user
complaints are silent failures, no review/approval UI, and no audit trail.
The proposed core primitive is a shared review-queue — an "agent inbox" where
agent-produced work products (drafted replies, enriched leads, screened
candidates, triaged tickets) queue for human review — so each one-click
template stays thin.

The framework already contains **two partial implementations of
human-review**, neither of which is that primitive: a synchronous per-call
approval gate in core, and an asynchronous approval queue in Dispatch that is
hardcoded to Dispatch's own four resource kinds. Designing the general
primitive without reconciling these two would create a third overlapping
mechanism; designing it *from* them is mostly a generalization exercise. This
spike produces the design document that decides the data model, API surface,
and UI shape — the highest-leverage prerequisite for the whole one-click
catalog.

## Current state

Verified at commit `f1c6e017bc`:

**Prior art #1 — core's synchronous `needsApproval` gate.**
`packages/core/docs/content/human-approval.mdx` documents that `defineAction`
accepts `needsApproval: boolean | (args, ctx) => boolean` — when truthy, the
agent loop pauses, emits `approval_required`, and runs the action only after a
human approves that specific call. The doc's design stance is explicit and
must be honored:

> "Keep approvals rare. Every gated action is a hard stop in the agent loop —
> it interrupts the run and demands a human round-trip. Use `needsApproval`
> only for genuinely high-consequence, hard-to-undo, outward-facing
> operations. … The default is **off**, and almost every action should leave
> it off."

**Prior art #2 — Dispatch's asynchronous approval queue.**
- `packages/dispatch/src/actions/set-dispatch-approval-policy.ts` — full file
  is ~25 lines: `defineAction` with `schema: z.object({ enabled: z.boolean(),
  approverEmails: z.array(z.string().email()).default([]) })`, persisting via
  `getApprovalPolicy`/`setApprovalPolicy` from
  `../server/lib/dispatch-store.js`.
- `packages/dispatch/src/routes/pages/approvals.tsx` — a working
  review UI: `useActionQuery("list-dispatch-approvals")`,
  `useActionMutation("approve-dispatch-change")`,
  `useActionMutation("reject-dispatch-change")`, a policy `Switch`, and
  approver-email management. Its scope line (in the rendered copy, around
  line 62): *"Applies to saved destinations, shared dream proposals, All-app
  workspace resources, and dispatch settings."* — i.e. a **fixed enum of
  Dispatch's own resource kinds**, not arbitrary agent outputs.
- `packages/dispatch/src/actions/list-dispatch-audit.ts` and
  `packages/dispatch/src/routes/pages/audit.tsx` — a matching audit surface.

**Prior art #3 — the core audit log.** `packages/core/src/audit/actions/`
contains `list-audit-events.ts` and `get-audit-event.ts` (scoped, paginated
reads). Any new primitive must write to this audit trail rather than invent
its own.

**Where a shared primitive would live.** `packages/toolkit` is the designated
home for reusable cross-template building blocks, but it is early:
`packages/toolkit/src/onboarding/index.ts` is literally `export {};`. Core
(`packages/core`) is the alternative home; publishable package changes need a
`.changeset/*.md`.

**Design constraint from the maintainer**: human-in-the-loop approvals are
rare and opt-in by policy (the human-approval doc's warning above reflects a
standing decision). The agent-inbox concept does NOT contradict this — it is
not a gate that pauses the loop; it is a queue of completed work products
awaiting human action (send/apply/publish). The design must keep that
distinction sharp.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| List Dispatch approval actions | `ls packages/dispatch/src/actions \| grep -i approv` | approve/reject/list/set-policy files |
| Read the store layer | `grep -n "ApprovalPolicy\|pendingChange\|approval" packages/dispatch/src/server/lib/dispatch-store.ts \| head -30` | persistence helpers |
| Find `needsApproval` runtime | `grep -rn "needsApproval" packages/core/src --include="*.ts" -l` | the loop + action files |
| Confirm no source changes | `git status --porcelain -- . ':!advisor-plans'` | empty output |

## Scope

**In scope** (the only files you may create or modify):
- `advisor-plans/reports/002-agent-inbox-design.md` (create — the deliverable)
- `advisor-plans/README.md` (status row update only)

**Out of scope** (do NOT touch):
- Everything else. Do NOT implement the primitive, do NOT refactor Dispatch,
  do NOT add schema files. This plan produces a design document.

## Git workflow

- Stay on the current branch. This repo explicitly prohibits creating,
  switching, or otherwise moving branches unless the operator asks for that
  exact operation.
- Do NOT commit or push unless the operator instructed it. Never add
  `Co-Authored-By` or agent attribution to any commit.

## Steps

### Step 1: Map both existing mechanisms end to end

Read, in full: `packages/dispatch/src/actions/set-dispatch-approval-policy.ts`,
`approve-dispatch-change.ts`, `reject-dispatch-change.ts`,
`list-dispatch-approvals.ts` (same dir), the persistence helpers they call in
`packages/dispatch/src/server/lib/dispatch-store.ts`, and
`packages/dispatch/src/routes/pages/approvals.tsx`. Then find the
`needsApproval` runtime path in `packages/core/src` (grep above) and read the
loop-pause/approve flow plus `packages/core/docs/content/human-approval.mdx`.
Document each mechanism's: data model (tables/columns), item lifecycle
(states + transitions), policy model, authorization/scoping, notification
surface, and audit-log integration.

**Verify**: report draft has a "Prior art" section with the two mechanisms
described in those six dimensions each.

### Step 2: Define the agent-inbox item model

Design the general primitive's data model. Must answer, with concrete
proposed schemas (Drizzle-style, provider-agnostic, additive-only):
- What is a queue item? (proposed: `{ id, kind, title, summary, payload
  (JSON reference — obey the no-large-blobs-in-SQL rule: store handles/ids,
  not file bodies), sourceActionName, proposedActionName + args, state:
  pending | approved | rejected | applied | failed | expired, reviewer,
  decidedAt, appliedAt, error }`)
- Ownership/scoping: the table must use `ownableColumns()` and be read/written
  through `accessFilter`/`resolveAccess`/`assertAccess`.
- How "apply" executes: re-invoke a named action with stored args (aligning
  with the actions-as-single-source-of-truth contract) vs. a stored callback
  (rejected — not serializable).
- Idempotency and failure: what happens when apply fails; when an item goes
  stale (the underlying data changed since queuing).

**Verify**: report has a "Data model" section containing at least one fenced
code block with the proposed table definition.

### Step 3: Define the API and UI surface

Specify:
- Actions (the single source of truth): `queue-review-item`,
  `list-review-items`, `approve-review-item` (applies), `reject-review-item`,
  plus policy actions. Name them, give zod schema sketches, and state which
  are agent-callable vs UI-only.
- The reusable UI: one shared inbox page/panel component (shadcn-based, no
  custom dropdowns) that templates mount; per-item render delegates to a
  registered renderer keyed by item `kind` (mirror how the framework
  registers other per-type renderers rather than hardcoding a switch).
- Notification hooks: how dispatch/mail/Slack surfaces learn "3 items await
  review" (reuse existing integration-webhooks/dispatch patterns; do not
  design a new notification system).
- The relationship to `needsApproval`: keep both, with a decision rule —
  synchronous gate for irreversible calls mid-run (rare); async inbox for
  reviewable work products (the one-click default). State explicitly that the
  inbox must NOT pause agent runs.
- Where it lives: recommend `packages/core` vs `packages/toolkit` vs
  `packages/dispatch`, with rationale (note: Dispatch already depends on the
  pattern; core owns actions/audit; toolkit is nearly empty).

**Verify**: report has "Actions", "UI", and "Placement" sections; the Actions
section names ≥ 4 actions with schema sketches.

### Step 4: Migration and adoption path

Describe how Dispatch's existing approvals become consumers of (or coexist
with) the new primitive without breaking its current UX, and how the first
one-click template (whichever plan 001's report recommends) would adopt it.
List open questions the maintainer must answer, each phrased as a decision
with a recommended default.

**Verify**: report has "Migration" and "Open questions" sections; every open
question carries a recommended default.

### Step 5: Finalize the report

Write `advisor-plans/reports/002-agent-inbox-design.md` with exactly these
top-level sections: `## Prior art`, `## Data model`, `## Actions`, `## UI`,
`## Placement`, `## Migration`, `## Open questions`.

**Verify**: `grep -c '^## ' advisor-plans/reports/002-agent-inbox-design.md`
→ `7`

## Test plan

No code tests — the deliverable is a design document. The section-count greps
and the clean `git status` (outside `advisor-plans/`) are the gates. The
design itself must include a "Test plan" subsection under `## Migration`
describing how the future implementation will be tested (unit tests on state
transitions; an integration test that queues → approves → applies a real
action).

## Done criteria

- [ ] `advisor-plans/reports/002-agent-inbox-design.md` exists with the seven
      required sections (`grep -c '^## ' …` → 7)
- [ ] The data-model section uses `ownableColumns()` and names the audit-log
      integration point
- [ ] The design states explicitly that inbox items never pause agent runs
      (search the report for "pause")
- [ ] `git status --porcelain -- . ':!advisor-plans'` → empty
- [ ] `advisor-plans/README.md` status row for 002 updated

## STOP conditions

Stop and report back (do not improvise) if:

- A generalized review-queue already exists in core or toolkit (search for
  `review-item`, `reviewQueue`, `agent-inbox`, `agentInbox` in
  `packages/core/src` and `packages/toolkit/src` first) — the work may have
  started since this plan was written.
- Dispatch's approval actions have moved or been rewritten (drift check
  fails).
- You are tempted to start implementing schema or actions — out of scope.

## Maintenance notes

- This design gates the one-click template catalog (plan 001's output). Build
  order after both reports land: primitive first, then the first template on
  top of it.
- Reviewers should scrutinize the `needsApproval`-vs-inbox decision rule
  hardest; if the two mechanisms' responsibilities blur, templates will gate
  routine work behind loop-pausing approvals — exactly what the
  human-approval doc warns against.
- Deferred deliberately: any change to Dispatch's current approvals UX, and
  cross-workspace (multi-app) inbox aggregation — note them as future
  directions in the report if relevant.
