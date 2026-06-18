# Execution Plan: Live Builder CMS Writes (End-User End-to-End Push)

**Audience:** Codex (or any coding agent) continuing PR #1173 on branch
`codex/content-source-aware-foundation`. This document is self-contained —
you do not need prior conversation context.

**Repo area:** everything is under `templates/content/` unless noted.

---

## 1. Goal

Take the source-aware Builder foundation from its current **dry-run-only**
state to where an **end user** can:

1. Attach a Builder CMS source to a content database,
2. Edit content locally and propose a change,
3. Review/approve it,
4. **Push it live to Builder** (the write actually hits Builder's API), and
5. See the result reconciled back into local state.

The foundation deliberately stops short of the live write (it is gated off on
purpose). Your job is to build the live-write layer and the end-user UI to
drive it — **without weakening the safety model** (no live write without an
approved change-set, an explicit push-mode opt-in, and an enabled capability).

---

## 2. Ground rules (read before writing code)

- **Follow the existing action pattern exactly.** See
  `actions/prepare-builder-source-execution.ts` as the canonical scaffold:
  `defineAction({ description, schema: z.object({...}), run })`, resolve the
  database via `resolveDatabaseForSourceMutation(args)`, gate with
  `await assertAccess("document", database.documentId, "editor")`, load the
  source via `getContentDatabaseSourceSnapshot(database)`, mutate via
  `getDb()` + `schema.*`, and return `getContentDatabaseResponse(database.id)`.
- **Do not relax the safety invariants.** The whole point of this foundation is
  that a live write is impossible unless: (a) the change-set is `approved`,
  (b) the change-set `direction` is `outbound`, (c) push mode is one of
  `autosave|draft|publish` (with `draft`/`publish` requiring explicit opt-in),
  and (d) the source capability `liveWritesEnabled === true`. Keep all four.
- **Idempotency is mandatory.** Every execution already carries an
  `idempotencyKey` (`builderCmsExecutionIdempotencyKey({sourceId, changeSetId,
  pushMode})`). A re-run with the same key must NOT double-write.
- **Tests are part of done.** There are existing tests that assert writes are
  blocked; you will be **intentionally changing one invariant** (see §4.1), so
  update those tests deliberately and add new ones for the live path. Run
  `npm run test` and `npm run typecheck` in `templates/content/` before
  considering any milestone complete. (Note: `@agent-native/core` must be built
  for typecheck — run `pnpm --filter @agent-native/core build` once.)
- **No secrets in code.** Builder credentials come from environment via
  `resolveBuilderCredential(...)` — never hardcode keys.

---

## 3. Current state (what already exists — do not rebuild)

The pipeline up to dry-run is **done and tested**:

| Stage | Action file | Touches Builder? |
|---|---|---|
| Attach | `actions/attach-content-database-source.ts` | Read-only (optional) |
| Refresh | `actions/refresh-content-database-source.ts` | No (local resync) |
| Propose | `actions/propose-content-database-source-change-set.ts` | No |
| Stage | `actions/stage-builder-revision.ts` | No |
| Review | `actions/review-content-database-source-change-set.ts` | No |
| Prepare | `actions/prepare-builder-source-execution.ts` | No |
| Validate | `actions/validate-builder-source-execution.ts` | No |
| **Execute (live)** | **does not exist** | — |

Key building blocks already in place:

- **`actions/_builder-cms-write-adapter.ts`**
  - `buildBuilderCmsExecutionPlan({source, changeSet, pushModeConfirmation})`
    builds the full execution plan: it computes the push-mode `intent`, the
    target row (`sourceRowId`), the `operations`, and a complete HTTP
    `request` object: `{ method: "POST"|"PATCH", path:
    "/api/v1/write/{model}[/{entryId}]", query: {...}, body: {...} }`.
    **It currently hardcodes `state = "write_disabled"` at line 251** and sets
    `lastError: "Live Builder writes are disabled for this source."`
  - `builderSafetyChecks(...)` returns `{ checks, blockers }`. Blockers include:
    no operations, body diffs (not supported in this slice), autosave without an
    entry ID, draft without `allowDraftWrites`, publish without
    `allowPublishWrites`, and disallowed push modes.
  - `validateBuilderCmsExecutionDryRun({storedPayload, plan, now})` re-derives
    the plan and compares against the stored payload to detect staleness.
  - `builderCmsExecutionIdempotencyKey(...)` — the stable key.
- **`actions/_builder-cms-read-client.ts`** — the auth + transport pattern to
  mirror for writes: `resolveBuilderCredential("BUILDER_PRIVATE_KEY")` (falls
  back to `BUILDER_CMS_PRIVATE_KEY`), `Authorization: Bearer ${privateKey}`,
  host from `BUILDER_CONTENT_API_HOST`/`BUILDER_CMS_API_HOST` env. Read path
  uses Builder's MCP content endpoint; the **write** path uses the REST write
  API at host + `request.path` (`/api/v1/write/...`).
- **`actions/_database-source-utils.ts`** — `normalizeCapabilities(...)` (lines
  ~202-218) reads capability flags from `capabilitiesJson`. Defaults:
  `liveWritesEnabled: false`, `canPush: false`, `readOnlyRefresh: true`,
  `canWriteFields/canWriteBody: false`, `canRefresh: true`.
- **Execution record table:** `schema.contentDatabaseSourceExecutions` with
  columns `state`, `idempotencyKey`, `payloadJson`, `summary`, `lastError`,
  `pushMode`, `adapter`, `sourceId`, `changeSetId`. Migration is v45 in
  `server/plugins/db.ts`.
- **Execution states** (`shared/api.ts:339`):
  `"ready" | "write_disabled" | "blocked" | "running" | "succeeded" | "failed"`.
  Note `ready` and `running`/`succeeded`/`failed` already exist but are
  currently unreachable.
- **UI hooks** in `app/.../DocumentDatabase.tsx`:
  `useAttachContentDatabaseSource`, `useProposeContentDatabaseSourceChangeSet`,
  `useReviewContentDatabaseSourceChangeSet`, `usePrepareBuilderSourceExecution`,
  `useValidateBuilderSourceExecution`, `useStageBuilderRevision`. There is
  **no** model-picker dialog, change-set review card, push button, or execution
  status UI yet.

---

## 4. The work, in milestones

Milestones are ordered so that **M1–M4 unblock internal dogfooding** (a
developer driving via agent actions can push live), and **M5 makes it real for
end users** (UI). Ship and verify each milestone independently.

### M1 — Make the dry-run gate conditional (engine)

**File:** `actions/_builder-cms-write-adapter.ts`

- In `buildBuilderCmsExecutionPlan`, replace the hardcoded
  `const state: ContentDatabaseSourceExecutionState = "write_disabled";`
  (line ~251) with conditional logic:
  - If `safety.blockers.length > 0` → `state = "blocked"`.
  - Else if `args.source.capabilities.liveWritesEnabled !== true` →
    `state = "write_disabled"` (unchanged behavior when disabled).
  - Else → `state = "ready"`.
- Update `summary` and `lastError` accordingly: only set the
  "live writes are disabled" `lastError` when actually `write_disabled`; for
  `blocked`, surface the blocker summary; for `ready`, `lastError` should be
  null/undefined and the summary should say it is ready to execute.
- Keep `payload.safety.liveWritesEnabled` / `dryRunOnly` reporting accurate.

**Tests to update** (`actions/_builder-cms-write-adapter.test.ts`):
- The test `"keeps the plan write-disabled even when live writes are
  configured"` is now **wrong by design** — change it to assert that with
  `liveWritesEnabled: true` and no blockers the plan state is `"ready"`.
- Keep/extend the blocker tests (autosave w/o entry ID, draft/publish w/o
  opt-in) — they should now produce `state: "blocked"`, not `write_disabled`.
- Keep a test that with `liveWritesEnabled: false` the state stays
  `write_disabled`.

**Acceptance:** plan state is `ready` only when enabled AND unblocked; all three
states reachable; tests green.

### M2 — Builder write client (engine)

**New file:** `actions/_builder-cms-write-client.ts`

- Mirror `_builder-cms-read-client.ts` for auth/host resolution. Export an async
  function, e.g.:
  ```ts
  export async function executeBuilderCmsWrite(args: {
    request: { method: "POST" | "PATCH"; path: string;
               query?: Record<string, string>; body: unknown };
    fetchImpl?: typeof fetch; // injectable for tests
  }): Promise<{ ok: boolean; status: number; entryId?: string;
               responseBody: unknown; error?: string }>
  ```
- Resolve the private key via `resolveBuilderCredential("BUILDER_PRIVATE_KEY")`
  (fallback `BUILDER_CMS_PRIVATE_KEY`). If missing, return a structured
  "unconfigured" error — **do not throw raw**.
- Build the URL from the write host (env: reuse
  `BUILDER_CONTENT_API_HOST`/`BUILDER_CMS_API_HOST`, default the Builder write
  host) + `request.path` + serialized `request.query`.
- Send `Authorization: Bearer ${privateKey}`, `content-type: application/json`,
  `request.body` as JSON. Use `args.fetchImpl ?? fetch`.
- Parse the response; extract the created/updated entry id when present (POST
  responses return the new id — needed for reconcile in M4).
- Return structured results; never leak the key into errors/logs.

**Tests:** new `actions/_builder-cms-write-client.test.ts` using an injected
`fetchImpl` mock — assert correct URL/method/headers/body for each intent,
unconfigured-key handling, and non-2xx handling. **No real network calls.**

**Acceptance:** unit-tested write client with injectable fetch; auth via env.

### M3 — The `execute-builder-source-execution` action (engine)

**New file:** `actions/execute-builder-source-execution.ts`

Follow the `prepare-builder-source-execution.ts` scaffold. Schema:
```ts
z.object({
  databaseId: z.string().optional(),
  documentId: z.string().optional(),
  changeSetId: z.string(),
  idempotencyKey: z.string().optional(), // must match stored if provided
  pushModeConfirmation: z.enum(["autosave","draft","publish"]).optional(),
})
```
`run` logic:
1. Resolve database + `assertAccess(..., "editor")` + load source snapshot;
   require `sourceType === "builder-cms"`.
2. Find the change-set; require `state === "approved"` and
   `direction === "outbound"`.
3. **Re-build the plan** with `buildBuilderCmsExecutionPlan(...)` and
   **re-validate** against the stored execution payload via
   `validateBuilderCmsExecutionDryRun(...)` — if stale, abort with a clear
   error (do not write stale data).
4. **Hard gates (defense in depth, do not skip even though the plan encodes
   them):** refuse unless `source.capabilities.liveWritesEnabled === true`,
   `plan.state === "ready"`, and `plan.idempotencyKey` matches
   `args.idempotencyKey` when provided.
5. **Idempotency:** load the execution row by `(idempotencyKey, sourceId)`. If
   it is already `succeeded`, return early (no re-write). If `running`, refuse
   (concurrent). Otherwise set state `running` before the call.
6. Call `executeBuilderCmsWrite({ request: plan.payload.request })`.
7. On success: set execution `state: "succeeded"`, store response (incl. new
   entry id) in `payloadJson`, clear `lastError`; transition the change-set to
   `applied`; proceed to M4 reconcile. On failure: `state: "failed"`, store
   `lastError`; leave the change-set `approved` (retryable).
8. Return `getContentDatabaseResponse(database.id)`.

**Register the action** wherever actions are indexed (match how
`prepare-builder-source-execution` is wired) and **document it in
`templates/content/AGENTS.md`** in the Document Operations table (mirror the
existing `prepare-`/`validate-` rows; note it performs a real write only when
live writes are enabled).

**Tests:** new `actions/execute-builder-source-execution.test.ts` with injected
fetch — cover: refuses when `liveWritesEnabled` false; refuses unapproved/stale;
happy path sets `succeeded` + change-set `applied`; idempotent re-run does not
double-write; failure path sets `failed` + retryable.

**Acceptance:** an approved + enabled change-set produces exactly one live write
and correct state transitions; all guard paths covered.

### M4 — Reconcile after write (engine)

After a successful write, local state must match Builder:

- For `POST` (new entry): capture the returned entry id and persist it onto the
  source row (`sourceRowId`, `sourceQualifiedId` =
  `builder-cms://{model}/{entryId}`) so future edits PATCH the same entry.
- Refresh `freshness`/`lastSourceUpdatedAt`/`provenance` for the affected
  row(s) — reuse `resyncBuilderCmsSourceSnapshot` / the helpers in
  `_database-source-utils.ts` rather than inventing a new path.
- Ensure a second propose→approve→execute cycle on the same row PATCHes
  (does not create a duplicate).

**Tests:** assert post-write the row carries the Builder entry id and a
follow-up execution targets PATCH on that id.

**Acceptance:** round-trip is stable; no duplicate entries on repeat pushes.

### M5 — Enable mechanism + credential surfacing (config)

`liveWritesEnabled` must have a real, safe way to turn on (today it is only ever
`false`). Choose ONE primary mechanism and wire it through
`normalizeCapabilities` / attach:

- **Preferred:** a per-source toggle action (e.g.
  `set-content-database-source-write-mode`) that sets `liveWritesEnabled` (and
  optionally `allowDraftWrites`/`allowPublishWrites`/`allowedWriteModes`) in the
  source `capabilitiesJson`, gated by `assertAccess(..., "editor")`. This keeps
  enablement explicit and per-source.
- Also accept an env-based default if useful for dogfico deploys (e.g.
  `BUILDER_LIVE_WRITES_ENABLED=true`) — but the per-source toggle should win.

Confirm credential story: reads/writes both use `BUILDER_PRIVATE_KEY` at
deploy/runtime. Document required env in `AGENTS.md` / README for the template.

**Acceptance:** a user/agent can enable live writes for a specific source via an
audited action; disabled remains the default.

### M6 — End-user UI (the bulk of "end user" vs "agent")

In `app/` (the data hooks already exist — see §3). Build:

1. **Source/model picker** on attach: list Builder CMS models (the
   `listBuilderCmsModels` read action exists) and let the user choose, instead
   of an agent-only flow.
2. **Change-set review card/modal:** show field diffs (old → proposed) with
   **Approve / Reject**, wired to `useReviewContentDatabaseSourceChangeSet`.
3. **Push control:** a "Push to Builder" button that calls prepare → validate →
   the new execute action, with an explicit push-mode confirmation
   (autosave/draft/publish) and a guard when `liveWritesEnabled` is false
   (offer the M5 enable toggle).
4. **Execution status:** surface `running`/`succeeded`/`failed` + `lastError`
   and a stale/blocked indicator.

Reuse the existing `liveWritesEnabled`/`dryRunOnly` display bindings already
present in `DocumentDatabase.tsx`.

**Acceptance:** a user can do attach → edit → review → push entirely from the UI
with no agent/CLI step, and see the outcome.

---

## 5. Known gotchas

- **Body diffs are intentionally unsupported in this slice** (a blocker in
  `builderSafetyChecks`). Field operations only. Do not silently start writing
  bodies — if you add body support, do it as an explicit, separately-gated
  follow-up.
- **Two "Local files" nav buttons** currently render in
  `app/components/sidebar/DocumentSidebar.tsx` (one from local-file mode's
  `renderLocalFilesNavButton()` near line 924, one in the footer). Unrelated to
  this work but worth deduping if you touch the sidebar.
- **The local schema is intentionally separate from Steve's Local File Mode**
  (his flat `source_*` columns vs. these normalized `content_database_source*`
  tables). Do NOT try to merge them — convergence is a deliberate later
  decision. Keep this work additive.
- **Idempotency key includes push mode** — changing push mode is a different
  execution, by design.

## 6. Definition of done

- [ ] Plan state is conditional (`ready`/`blocked`/`write_disabled`); invariant
      tests updated (M1).
- [ ] Write client with env auth + injectable fetch, unit-tested (M2).
- [ ] `execute-builder-source-execution` action: real write, full guards,
      idempotent, correct state transitions, registered + documented in
      `AGENTS.md` (M3).
- [ ] Post-write reconcile persists entry id + freshness; repeat pushes PATCH
      (M4).
- [ ] Per-source enable mechanism for `liveWritesEnabled`; default stays off;
      env documented (M5).
- [ ] End-user UI: model picker, review card, push button + push-mode confirm,
      execution status (M6).
- [ ] `npm run test` and `npm run typecheck` green in `templates/content/`
      (build `@agent-native/core` first).
- [ ] End-to-end: a user attaches a Builder source, edits, approves, and pushes
      a field change that appears in Builder; a second edit updates the same
      entry.

## 7. Suggested commit/PR sequence

M1+M2 together (engine groundwork, no behavior change for disabled sources) →
M3+M4 (live execute + reconcile, still off by default) → M5 (enable) → M6 (UI).
Each is independently reviewable; the product stays safe-by-default until M5 is
deliberately used.

## 8. UI note — read-only Source panel cleanup (added 2026-06-17)

The Source panel was simplified ahead of this work (PR #1173). M5/M6 must
account for what changed:

- Default connected view is now minimal: source name + a Read-only / Live
  writes on badge, an "<account> · synced <relative>" line (auto-syncs on panel
  open + window focus), a dormant "N changes ready → Review diff" slot (hidden
  at zero changes), and a bottom "Disconnect source".
- The **live-writes enable toggle was removed** — M5/M6 must reintroduce it.
  The `onSetBuilderLiveWrites` prop plumbing through `DatabaseSettingsSourcePanel`
  is still in place (currently unused), ready to rewire.
- **Consolidate the duplicate outbound-review surfaces.** The new header
  "Review diff" slot (opens the review dialog via `onReviewBuilderUpdate`) and
  the Code-Mode "Local Builder changes" inline cards both render
  `outboundChangeSets`. M6 should pick one path (recommend the dialog) so a user
  isn't shown two ways to review the same pending push.
- Aggregate "Field mappings" and "Row identity" panels were removed; per-field
  mapping now lives in each column's menu (`PropertyManagementPopover`). Keep
  that pattern — surface per-entity facts on the entity, not in panel rosters.
