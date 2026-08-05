# Automation Sharing Implementation Plan

> **For the Fusion agent:** Execute this plan task-by-task in order. Re-read every target file immediately before editing, preserve concurrent work, and complete each verification checkpoint before moving to the next task. Do not report the feature complete until the focused tests, workspace checks, and authenticated browser QA all pass on the final code.

## Goal

Ship row-level sharing for resource-backed automations while preserving `jobs/*.md` as the definition source of truth and preserving creator-bound execution. Replace the Personal/Organization UI sections with one access-aware Automations list. Owners can choose Personal, Organization (all current organization members View), or Specific people; specific users receive View or Collaborate. Collaborators may edit, pause/resume, and run now, while only owners may delete or manage sharing. Public sharing is intentionally excluded.

## Architecture

Add a job-specific SQL sharing overlay keyed by `resources.id`; do not migrate definitions out of `jobs/*.md` and do not reuse the generic resource `visibility` column, whose current meaning is workspace versus agent scratch. A core automation access service combines resource ownership, parsed immutable creator metadata, overlay visibility, current organization membership, and explicit user grants into one effective role: `owner`, `collaborate`, or `view`.

All reads and mutations—`manage-automations`, direct Agent-page actions, run history, pause/resume, run-now, delete, and sharing replacement—must call that same access service. Create/edit submits a complete sharing state and commits the definition plus overlay/grants atomically. Legacy organization-owned jobs without an overlay are interpreted as organization-visible compatibility rows until the owner writes explicit sharing; there is no destructive backfill.

The UI consumes one unified list action, renders role-derived capabilities, and uses optimistic cache updates with exact rollback snapshots and inline errors. The create/edit dialog owns only transient draft state; the existing `/agent#jobs` navigation and application-state contract remain unchanged. Schedule, event, and manual acquisition continue to use the existing scheduler, dispatcher, durable run queue, and background runner. Authorization may allow a collaborator to request run-now, but execution identity is still resolved from immutable `createdBy`/`runAs: creator` metadata.

## Tech Stack

- TypeScript
- React 19 and TanStack Query
- Agent Native `defineAction`, action discovery, and request context
- Core `resources` store and `getDbExec()` portable SQL abstraction
- SQLite, Postgres, and D1-compatible additive DDL
- Zod validation
- shadcn/toolkit Dialog, Picker, Avatar, Button, and form primitives
- Tabler Icons
- i18next through `useT()` and the core default message catalog
- Vitest and React DOM test utilities
- pnpm workspace scripts, oxfmt, package guards, and authenticated browser QA

## 1. Establish the baseline and freeze the existing execution contract

**Files to inspect:**

- `packages/core/src/resources/store.ts`
- `packages/core/src/automations/service.ts`
- `packages/core/src/jobs/run-now.ts`
- `packages/core/src/jobs/background-automation-runner.ts`
- `packages/core/src/jobs/scheduler.ts`
- `packages/core/src/triggers/dispatcher.ts`
- `packages/core/src/triggers/actions.ts`
- `packages/core/src/jobs/actions/list-recurring-jobs.ts`
- `packages/core/src/jobs/actions/manage-recurring-job.ts`
- `packages/core/src/jobs/actions/run-automation-now.ts`
- `packages/core/src/jobs/actions/list-automation-runs.ts`

**Steps:**

1. Read the current branch versions again and record the exact current signatures before editing; do not assume this plan supersedes concurrent changes.
2. Confirm the current immutable execution path:
   - new explicit automations persist `createdBy` and `runAs: creator`;
   - scheduled and event paths resolve the creator before execution;
   - run-now creates a durable `automation_runs` row and converges on the same background runner.
3. Confirm the legacy cases that must remain compatible: personal owner rows, encoded organization owners, and `__shared__` resources.
4. Run the current focused tests before implementation so later failures can be attributed to the change.

**Verification checkpoint:**

```bash
pnpm --filter @agent-native/core exec vitest --run \
  src/automations/service.spec.ts \
  src/jobs/actions/actions.spec.ts \
  src/jobs/background-automation-runner.spec.ts \
  src/jobs/scheduler.spec.ts \
  src/triggers/actions.spec.ts \
  src/triggers/dispatcher.spec.ts
```

**Expected result:** all existing automation service, action, scheduler, dispatcher, and runner tests pass without code changes. Any pre-existing failure is documented and resolved before implementation proceeds rather than being hidden by the new work.

## 2. Add dialect-portable job sharing storage

**Files:**

- Create `packages/core/src/automations/sharing-store.ts`
- Create `packages/core/src/automations/sharing-store.spec.ts`
- Modify `packages/core/src/resources/store.ts`
- Modify `packages/core/src/resources/index.ts`
- Modify `packages/core/src/db/client.ts` only if the current `DbExec` transaction contract cannot support the required transaction-scoped resource operations

**Steps:**

1. Define explicit domain types in `sharing-store.ts`:
   - visibility: `private | organization`;
   - grant role: `view | collaborate`;
   - complete sharing input for Personal, Organization, or Specific people;
   - stored overlay/grant rows and a normalized sharing summary.
2. Add idempotent startup DDL for two core-owned tables:
   - one overlay row keyed by job resource id, with visibility and organization id;
   - user grants keyed uniquely by resource id plus normalized user email, with View/Collaborate role.
3. Add portable indexes for organization-visible listing and user-grant listing. Use `ensureTableExists`/`ensureIndexExists` on Postgres and the existing retry/idempotency pattern on SQLite/D1. Do not add destructive DDL, provider-only SQL, or `drizzle-kit push`.
4. Add batched store operations to load overlays and grants for many resource ids in bounded queries. Do not build an N+1 API.
5. Add a transaction-scoped “replace complete sharing state” operation that deletes obsolete grants and inserts/updates the desired overlay/grants as one unit.
6. Extend the resource store with a transaction-scoped put/delete seam that accepts the existing `DbExec` abstraction and preserves resource ids. Queue resource change/delete notifications until the transaction has committed so polling cannot observe an event for a rolled-back write.
7. Keep the existing `ResourceVisibility = workspace | agent_scratch` unchanged. The job overlay must not overload it.
8. Test initialization, normalization, uniqueness, batched reads, complete replacement, rollback, and portability-sensitive SQL behavior.

**Verification checkpoint:**

```bash
pnpm --filter @agent-native/core exec vitest --run \
  src/automations/sharing-store.spec.ts \
  src/resources/store.effective-context.spec.ts \
  src/resources/store.learnings-seed.spec.ts
pnpm guard:additive-migrations
```

**Expected result:** the overlay initializes idempotently; complete replacement either fully commits or leaves the old state intact; resource store regressions pass; the additive-migration guard reports no destructive schema change.

## 3. Build the single automation access service and unified listing

**Files:**

- Create `packages/core/src/automations/access.ts`
- Create `packages/core/src/automations/access.spec.ts`
- Modify `packages/core/src/automations/service.ts`
- Modify `packages/core/src/automations/service.spec.ts`
- Modify `packages/core/src/resources/store.ts`
- Modify `packages/core/src/jobs/frontmatter.ts` only if a shared typed classifier/result is needed by both explicit and legacy definitions

**Steps:**

1. Implement one access resolver that accepts the caller identity and stable resource id, loads the `jobs/*.md` resource, parses its classification/frontmatter, and returns either no access or:
   - effective role `owner | collaborate | view`;
   - immutable creator and owning organization;
   - explicit or legacy effective visibility;
   - a sharing summary suitable for the list row;
   - capability flags derived centrally from the role.
2. Derive ownership without changing execution metadata:
   - personal resource owner email is the owner;
   - organization resource `createdBy` is the owner;
   - malformed or mismatched creator metadata fails closed for mutations.
3. Implement legacy compatibility without writing data:
   - organization-owned rows with no overlay are organization-visible View to current members;
   - the immutable creator remains owner;
   - personal rows with no overlay remain private;
   - retain the current `__shared__` compatibility behavior without broadening its run identity.
4. Implement unified listing for all accessible `jobs/*.md` resources. Batch resource candidates, overlays, grants, current membership, and profile labels. Avoid one full SQL round trip per item and avoid loading run history on the list path.
5. Return both explicit automations and legacy recurring jobs in one typed list shape, preserving their classification so the UI can keep the correct editor.
6. Replace `canUpdate` as the authorization source with `effectiveRole` and explicit capabilities (`canEdit`, `canOperate`, `canDelete`, `canManageSharing`). Compatibility adapters may map these to old fields only at their external boundary.
7. Add tests for owner, org View member, explicit View, explicit Collaborate, revoked grant, removed member, outside-org grant, malformed creator, duplicate names under different owners, inaccessible-id non-disclosure, and no-overlay legacy behavior.
8. Add a query-count assertion or store mock assertion proving the list batches access data instead of issuing one overlay/grant query per resource.

**Verification checkpoint:**

```bash
pnpm --filter @agent-native/core exec vitest --run \
  src/automations/access.spec.ts \
  src/automations/service.spec.ts
```

**Expected result:** one list contains exactly the caller's owned, organization-visible, and explicitly shared rows; each row has the correct role/capabilities/sharing summary; legacy organization rows are visible without an overlay write; unauthorized or unreadable states fail closed.

## 4. Make definition and sharing writes atomic and role-aware

**Files:**

- Modify `packages/core/src/automations/service.ts`
- Modify `packages/core/src/automations/service.spec.ts`
- Modify `packages/core/src/jobs/run-history.ts`
- Modify `packages/core/src/jobs/run-history.spec.ts`
- Modify `packages/core/src/jobs/run-now.ts`
- Create `packages/core/src/jobs/run-now.spec.ts`
- Modify `packages/core/src/jobs/tools.ts`
- Modify `packages/core/src/jobs/tools.spec.ts`

**Steps:**

1. Extend create and owner edit service inputs with a complete sharing state. Validate all fields before starting a transaction:
   - Organization requires a current owning organization;
   - Specific people requires at least one unique existing account;
   - user emails are normalized;
   - only View/Collaborate are accepted;
   - no public value is representable or accepted;
   - outside-organization Collaborate requires an acknowledgement for this exact request.
2. Query the canonical auth `user` table to prove each selected account exists. Determine outside-organization status from actual membership in the owning organization, not the target's active organization.
3. Commit resource content and the complete sharing overlay/grant state in one transaction. Preserve `createdBy`, `runAs`, resource owner, and resource id during edits.
4. Permit definition edits and enable/disable changes for Collaborate, but reject sharing changes from Collaborate.
5. Require Owner for delete. Delete the resource, its overlay/grants, and its run history atomically so name reuse cannot inherit old state.
6. Evolve run-now to resolve by stable resource id and require Collaborate. Retain a name/scope compatibility adapter only for existing callers; resolve it to a resource before checking access.
7. Ensure a collaborator-requested run stores the original resource owner/history key and that the worker still calls the current creator identity resolver. Never put the collaborator into `createdBy`, `runAs`, run owner, event owner, or background request context.
8. Update legacy recurring-job mutation helpers to call the same access boundary: Collaborate may edit/pause/resume/run; Owner alone may delete.
9. Add transaction rollback tests that force the definition write and sharing write to fail independently and assert neither partial state survives.

**Verification checkpoint:**

```bash
pnpm --filter @agent-native/core exec vitest --run \
  src/automations/service.spec.ts \
  src/jobs/run-now.spec.ts \
  src/jobs/run-history.spec.ts \
  src/jobs/tools.spec.ts
```

**Expected result:** View cannot mutate; Collaborate can edit/pause/resume/run-now but cannot delete or share; Owner can do all operations; failed create/edit/delete leaves no partial definition, grant, overlay, or history state; collaborator run-now remains creator-bound.

## 5. Unify and secure the direct Agent-page actions

**Files:**

- Modify `packages/core/src/triggers/actions/list-automations.ts`
- Modify `packages/core/src/triggers/actions/manage-automation.ts`
- Create `packages/core/src/triggers/actions/search-automation-share-users.ts`
- Create `packages/core/src/triggers/actions/get-automation-sharing.ts` only if the unified list response cannot safely supply the editor's current grant details
- Modify `packages/core/src/jobs/actions/list-recurring-jobs.ts`
- Modify `packages/core/src/jobs/actions/manage-recurring-job.ts`
- Modify `packages/core/src/jobs/actions/run-automation-now.ts`
- Modify `packages/core/src/jobs/actions/list-automation-runs.ts`
- Modify `packages/core/src/jobs/actions/actions.spec.ts`
- Modify `packages/core/src/triggers/actions/actions.spec.ts`
- Modify `packages/core/src/server/action-discovery.ts`
- Modify `packages/core/src/server/action-discovery.spec.ts`
- Modify `packages/core/src/vite/action-types-plugin.ts`

**Steps:**

1. Change `list-automations` into the one frontend read for all accessible explicit and legacy definitions; remove its required Personal/Organization scope split.
2. Return stable resource id, classification, effective role, capability flags, and row sharing summary. Return complete grants only to the owner and only where the editor needs them.
3. Make `manage-automation` resource-id-first and include complete sharing state on create/owner edit. Keep compatibility fields only where existing callers still need them.
4. Update recurring-job actions to delegate to the same service/access boundary rather than retaining creator/org-admin authorization in parallel.
5. Make run-history and run-now resource-id-aware and access-controlled. View can read history; Collaborate can run-now.
6. Add a bounded, authenticated user-search action for the Specific people picker. It returns only existing-account fields needed by the UI plus `outsideOrganization`; it does not create invites, expose private account data, or accept an arbitrary organization id from the client as authority.
7. Register the new UI-only action(s) in action discovery and the Vite action type registry. Preserve `agentTool: false`; the conversational surface remains `manage-automations`.
8. Keep frontend actions under `defineAction` with Zod schemas and typed thrown failures. Do not add a REST twin route.
9. Update discovery and action tests to prove the new actions are registered, authenticated, frontend-only, and do not overwrite template actions.
10. Keep `list-recurring-jobs` available as a compatibility action if external UI consumers require it, but stop using it from `AgentJobsTab` after Task 7.

**Verification checkpoint:**

```bash
pnpm --filter @agent-native/core exec vitest --run \
  src/jobs/actions/actions.spec.ts \
  src/triggers/actions/actions.spec.ts \
  src/server/action-discovery.spec.ts
pnpm guard:no-action-twin-routes
```

**Expected result:** the frontend has one unified list action; all mutations enforce effective role server-side; search returns bounded existing-account results with outside-org labels; action discovery includes the new UI actions as non-agent tools; no duplicate API route is introduced.

## 6. Bring `manage-automations` to full agent parity

**Files:**

- Modify `packages/core/src/triggers/actions.ts`
- Modify `packages/core/src/triggers/actions.spec.ts`
- Modify `packages/core/src/agent/production-agent.ts` only if the native action schema registry requires a typed surface update

**Steps:**

1. Make `action=list` call the same unified access-aware service as the UI and return effective role and sharing summary for every accessible automation.
2. Add sharing inputs to define/update using a deliberate, documented shape for Personal, Organization, or Specific people. Do not expose `public` in the schema.
3. Add or extend an owner-only sharing operation if a complete sharing replacement cannot be expressed cleanly through update; keep it inside the single `manage-automations` tool rather than adding another agent tool.
4. Require the explicit outside-organization Collaborate acknowledgement in the agent call just as in the UI. The tool description must tell the agent to explain the consequence and receive user confirmation before setting it.
5. Route update, pause/resume, run-now, delete, and sharing through the same access service and stable resource id resolution used by direct actions.
6. Teach the tool description that View is read-only, Collaborate permits edit/pause/resume/run-now, only Owner can delete/manage sharing, public links are excluded, and every run still uses the creator's identity.
7. Preserve plan-mode read/write classification and existing confirmation requirements for create, delete, and real run-now side effects.
8. Avoid success-shaped error coercion. Service failures must remain distinguishable from valid empty lists and completed writes.
9. Add agent parity tests for owner, View, Collaborate, outside-org acknowledgement, public-value rejection, legacy organization visibility, and creator-bound run-now.

**Verification checkpoint:**

```bash
pnpm --filter @agent-native/core exec vitest --run src/triggers/actions.spec.ts
pnpm guard:no-error-string-returns
```

**Expected result:** the agent sees and can operate exactly the rows/capabilities the UI sees; public sharing is absent/rejected; outside-org Collaborate requires acknowledgement; errors are not returned as plausible success; the existing plan-mode contract still passes.

## 7. Replace split-scope hooks with one unified optimistic cache

**Files:**

- Modify `packages/core/src/client/agent-page/use-jobs.ts`
- Create `packages/core/src/client/agent-page/use-jobs.spec.tsx` if hook-level rollback behavior is not adequately covered by `AgentJobsTab.spec.tsx`

**Steps:**

1. Replace `useAutomations(scope)` plus separate personal/org cache keys with one `useAutomations()` query using the unified action.
2. Update the row type to include classification, stable resource id, effective role, capabilities, and sharing summary.
3. Make manage, pause/resume, run-now, delete, and sharing mutations resource-id-first.
4. Keep exact optimistic snapshots for every mutation and restore the prior cache on error. Do not use an empty array or dropped row as a failure fallback.
5. On successful create/edit/share/delete, reconcile or invalidate only the unified list and the affected run-history/sharing query. Remove invalidation of obsolete personal/org list keys.
6. Represent create drafts with their selected sharing label and capabilities so optimistic rows do not briefly claim the wrong access.
7. Keep run history lazy and keyed by resource id.

**Verification checkpoint:**

```bash
pnpm --filter @agent-native/core exec vitest --run \
  src/client/agent-page/use-jobs.spec.tsx \
  --passWithNoTests
```

**Expected result:** the hook uses one list cache; successful mutations update the correct row; forced failures restore the exact previous row/list; no stale Personal/Organization query key remains in the Agent-page hook.

## 8. Add the Sharing editor and existing-account picker

**Files:**

- Create `packages/core/src/client/agent-page/AutomationSharingFields.tsx`
- Create `packages/core/src/client/agent-page/AutomationSharingFields.spec.tsx`
- Modify `packages/core/src/client/agent-page/AutomationEditorDialog.tsx`
- Modify `packages/core/src/client/agent-page/AutomationEditorDialog.spec.tsx`
- Reuse patterns from `packages/core/src/client/sharing/ShareDialog.tsx`
- Reuse patterns from `packages/core/src/client/sharing/useShareButtonController.ts`
- Reuse `packages/core/src/client/sharing/share-controller-helpers.ts` only where its cache helpers fit; do not expose generic Public/Admin behavior to automation sharing

**Steps:**

1. Add a Sharing section to create and owner edit with mutually exclusive Personal, Organization, and Specific people controls.
2. Organization copy must state that every current organization member receives View only.
3. Build Specific people with toolkit/shadcn Picker and Avatar primitives backed by the authenticated user-search action. Do not accept a free-form nonexistent email.
4. Mark each result outside the owning organization. Preserve the marker on selected users.
5. Provide only View and Collaborate roles; do not expose generic sharing's Admin role.
6. When any outside-org account is set to Collaborate, show a required acknowledgement describing edit, pause/resume, run-now, and creator-bound execution. Bind acknowledgement validity to the current selected users/roles so later changes require acknowledgement again.
7. Hide or render sharing read-only for Collaborate editors. Only owners can submit a sharing replacement.
8. Submit one complete sharing state with the definition instead of firing sequential share/unshare mutations.
9. Keep selected users, roles, acknowledgement state, and definition fields when a save fails. Show the server error inline and keep the dialog open.
10. Do not render Public, copy-link, or anonymous-access controls. Do not modify the generic ShareDialog for this product-specific mode unless a reusable no-public/no-admin API is first proven to preserve its existing consumers.
11. Ensure logical-direction spacing and labels work in RTL.

**Verification checkpoint:**

```bash
pnpm --filter @agent-native/core exec vitest --run \
  src/client/agent-page/AutomationSharingFields.spec.tsx \
  src/client/agent-page/AutomationEditorDialog.spec.tsx
```

**Expected result:** all three modes submit the correct complete state; Specific people supports View/Collaborate existing accounts; outside-org Collaborate cannot submit before acknowledgement; Public is absent; collaborator edit cannot change sharing; service errors preserve the draft and remain inline.

## 9. Convert `AgentJobsTab` to one role-aware list

**Files:**

- Modify `packages/core/src/client/agent-page/AgentJobsTab.tsx`
- Modify `packages/core/src/client/agent-page/AgentJobsTab.spec.tsx`
- Modify `packages/core/src/client/agent-page/AgentJobsTab.blocked.spec.tsx`
- Modify `packages/core/src/client/agent-page/AutomationDetailsDialog.tsx`
- Create `packages/core/src/client/agent-page/AutomationDetailsDialog.spec.tsx` if access/status coverage cannot remain clear in the tab spec

**Steps:**

1. Remove Personal and Organization sections, section descriptions, duplicated loading/error states, and the organization section create button.
2. Render one stable unified list and retain the existing page-level New automation button.
3. Add row sharing presentation:
   - owned private: Personal;
   - organization-visible: Organization;
   - grantee: Shared with you · View/Collaborate;
   - owned Specific people: grantee count plus compact avatars/initials.
4. Use the server-returned capabilities rather than `canUpdate` or `canManageOrg` to render actions:
   - View: Details only;
   - Collaborate: Details, Edit, Run now, Pause/Resume;
   - Owner: all Collaborate actions plus Delete and sharing management through Edit.
5. Keep details, status, last/next run, blocked reason, and run-history behavior available to View.
6. Route every row operation by stable resource id. Delete remains behind the existing destructive confirmation and Owner authorization.
7. Surface row/dialog errors inline. Ensure an optimistic failure restores row state and does not close an editor or confirmation prematurely.
8. Keep `/agent#jobs` and Agent-page navigation unchanged; no new persistent application-state key is needed.
9. Update tests to cover a mixed list of owner Personal, owner Organization, owner Specific people, shared View, shared Collaborate, and legacy organization-visible rows. Assert forbidden controls are absent, not merely disabled.

**Verification checkpoint:**

```bash
pnpm --filter @agent-native/core exec vitest --run \
  src/client/agent-page/AgentJobsTab.spec.tsx \
  src/client/agent-page/AgentJobsTab.blocked.spec.tsx \
  src/client/agent-page/AutomationDetailsDialog.spec.tsx \
  --passWithNoTests
```

**Expected result:** there is exactly one Automations list and one loading/error boundary; every access label is correct; each role sees only its permitted actions; View can inspect details/status/history; blocked-run messaging remains truthful.

## 10. Update localization, canonical guidance, and product docs

**Files:**

- Modify `packages/core/src/localization/default-messages.ts`
- Modify `packages/core/src/client/i18n-key-coverage.spec.ts` only if new plural or dynamic-key coverage requires a test extension
- Modify `.agents/skills/automations/SKILL.md`
- Modify `packages/core/docs/content/automations.mdx`
- Modify `packages/core/docs/content/recurring-jobs.mdx` if legacy compatibility wording changes
- Modify all matching localized automation docs:
  - `packages/core/docs/content/locales/ar-SA/automations.mdx`
  - `packages/core/docs/content/locales/de-DE/automations.mdx`
  - `packages/core/docs/content/locales/es-ES/automations.mdx`
  - `packages/core/docs/content/locales/fr-FR/automations.mdx`
  - `packages/core/docs/content/locales/hi-IN/automations.mdx`
  - `packages/core/docs/content/locales/ja-JP/automations.mdx`
  - `packages/core/docs/content/locales/ko-KR/automations.mdx`
  - `packages/core/docs/content/locales/pt-BR/automations.mdx`
  - `packages/core/docs/content/locales/zh-CN/automations.mdx`
  - `packages/core/docs/content/locales/zh-TW/automations.mdx`

**Steps:**

1. Read the `writing-agent-instructions` skill immediately before editing the canonical automations skill.
2. Replace split-scope UI copy with unified-list, Personal/Organization/Specific people, View/Collaborate, outside-organization, acknowledgement, count/plural, and inline-error copy in the English core catalog.
3. Keep action names, role enum values, resource ids, and route fragments unlocalized.
4. Use plural keys for specific-user counts and preserve placeholders across translations.
5. Update the canonical automations skill to teach access roles, owner-only delete/sharing, no public links, outside-org acknowledgement, resource-id overlay, legacy compatibility, and creator-bound execution.
6. Update English automation docs and every existing localized automation doc when the meaning changes. If a locale cannot be translated in this task, stop and explicitly list it rather than silently shipping an English-only semantic change.
7. Update recurring-jobs docs only where needed to explain that legacy jobs participate in the unified list and compatibility visibility without definition migration.
8. Do not document a REST API or a public link flow.

**Verification checkpoint:**

```bash
pnpm --filter @agent-native/core exec vitest --run src/client/i18n-key-coverage.spec.ts
pnpm guard:i18n-catalogs
pnpm guard:workspace-skills
```

**Expected result:** every literal UI key exists in the English catalog; plural/placeholders are valid; workspace skill synchronization passes; English and all ten localized automation docs describe the same product contract.

## 11. Complete compatibility and security regression coverage

**Files:**

- Modify `packages/core/src/automations/access.spec.ts`
- Modify `packages/core/src/automations/service.spec.ts`
- Modify `packages/core/src/automations/sharing-store.spec.ts`
- Modify `packages/core/src/jobs/actions/actions.spec.ts`
- Modify `packages/core/src/jobs/run-now.spec.ts`
- Modify `packages/core/src/jobs/scheduler.spec.ts`
- Modify `packages/core/src/jobs/background-automation-runner.spec.ts`
- Modify `packages/core/src/triggers/actions.spec.ts`
- Modify `packages/core/src/triggers/dispatcher.spec.ts`
- Modify `packages/core/src/server/action-discovery.spec.ts`
- Modify `packages/core/src/client/agent-page/AgentJobsTab.spec.tsx`
- Modify `packages/core/src/client/agent-page/AutomationEditorDialog.spec.tsx`
- Modify `packages/core/src/client/agent-page/AutomationSharingFields.spec.tsx`

**Steps:**

1. Add a permission matrix test covering every operation for View, Collaborate, and Owner.
2. Add public-sharing rejection at schema, service, agent-tool, and direct-action boundaries.
3. Add account-validation tests for nonexistent users, normalized email duplicates, current org member, outside-org View, outside-org Collaborate without acknowledgement, and acknowledged outside-org Collaborate.
4. Add revocation tests: grant removal, organization membership removal, owner deletion, and unreadable membership/account lookup all fail closed on the next operation.
5. Add immutable-identity tests proving collaborator edits and run-now never change creator, resource owner, event owner, execution org, run-history owner, or `runAs`.
6. Add compatibility tests for no-overlay personal rows, no-overlay organization rows, current `__shared__` rows, explicit automations, and legacy recurring jobs.
7. Add atomicity tests for resource write failure, overlay write failure, grant write failure, history cleanup failure, and duplicate-name races.
8. Add UI rollback tests for pause/resume, edit, sharing, and delete failures with inline errors.
9. Add discovery tests proving all direct actions remain auth-protected and non-agent tools while `manage-automations` remains the agent surface.
10. Re-run scheduler/dispatcher regression tests to prove automatic acquisition did not start consulting the collaborator identity or sharing role.

**Verification checkpoint:**

```bash
pnpm --filter @agent-native/core exec vitest --run \
  src/automations/access.spec.ts \
  src/automations/service.spec.ts \
  src/automations/sharing-store.spec.ts \
  src/jobs/actions/actions.spec.ts \
  src/jobs/run-now.spec.ts \
  src/jobs/scheduler.spec.ts \
  src/jobs/background-automation-runner.spec.ts \
  src/triggers/actions.spec.ts \
  src/triggers/dispatcher.spec.ts \
  src/server/action-discovery.spec.ts \
  src/client/agent-page/AgentJobsTab.spec.tsx \
  src/client/agent-page/AutomationEditorDialog.spec.tsx \
  src/client/agent-page/AutomationSharingFields.spec.tsx
```

**Expected result:** the complete permission, compatibility, atomicity, revocation, UI rollback, and creator-identity matrix passes with no skipped security case.

## 12. Add the package changeset and run focused package checks

**Files:**

- Create `.changeset/automation-sharing.md`
- All modified TypeScript, TSX, MDX, and Markdown files from Tasks 2–11

**Steps:**

1. Add a minor changeset for `@agent-native/core` describing the user-facing unified automation sharing capability. Do not manually change the package version.
2. Run oxfmt on modified source files. Review formatting changes and ensure no unrelated files are touched.
3. Run the full core test selection relevant to the feature and package typecheck/build.
4. Inspect the final diff for secret literals, private data, raw colors, public-link language, debug logging, accidental source-generated artifacts, and manual migration/destructive SQL.

**Verification checkpoint:**

```bash
pnpm exec oxfmt --write \
  packages/core/src/automations \
  packages/core/src/jobs \
  packages/core/src/triggers \
  packages/core/src/client/agent-page \
  packages/core/src/localization/default-messages.ts \
  packages/core/src/server/action-discovery.ts \
  packages/core/src/vite/action-types-plugin.ts
pnpm --filter @agent-native/core typecheck
pnpm --filter @agent-native/core build
pnpm --filter @agent-native/core test
pnpm changeset:status
```

**Expected result:** formatting is clean; core typecheck, build, and tests pass; changeset status reports the pending `@agent-native/core` minor entry; no package version was edited manually.

## 13. Run i18n, security, workspace, and full preparation guards

**Files:**

- No new files; fix only failures caused by this implementation in the files already listed above

**Steps:**

1. Run the targeted guards first for fast feedback.
2. Run the repository preparation command on the final code. It includes formatting, workspace typecheck, fast tests, and all guards.
3. If a check fails, fix the actual boundary. Do not add an opt-out pragma unless the repository's documented exception genuinely applies and the reason is reviewer-visible.
4. Re-run the failed targeted check and then `pnpm prep` until the exact final code passes.

**Verification checkpoint:**

```bash
pnpm guard:additive-migrations
pnpm guard:no-silent-coercion
pnpm guard:no-error-string-returns
pnpm guard:no-unscoped-queries
pnpm guard:no-secret-literals
pnpm guard:no-raw-colors
pnpm guard:i18n-catalogs
pnpm guard:workspace-skills
pnpm prep
```

**Expected result:** every targeted guard and the complete preparation workflow pass on the final implementation. No failure is converted into an empty list, false success, or stale optimistic state.

## 14. Perform authenticated browser QA with multiple existing accounts

**Files to validate in the running app:**

- `packages/core/src/client/agent-page/AgentJobsTab.tsx`
- `packages/core/src/client/agent-page/AutomationEditorDialog.tsx`
- `packages/core/src/client/agent-page/AutomationSharingFields.tsx`
- `packages/core/src/client/agent-page/AutomationDetailsDialog.tsx`

**Steps:**

1. Start the workspace using the repository's configured development command:

```bash
pnpm dev
```

2. Use an existing organization and existing test accounts. Do not create a new organization, change an account's active organization, or move credentials between organizations merely to set up QA.
3. Open an authenticated app's `/agent#jobs` as the owner and verify:
   - one list and no Personal/Organization sections;
   - new Personal automation shows Personal;
   - Organization shows Organization and states View for members;
   - Specific people picker finds existing in-org and outside-org accounts;
   - outside-org labels are visible;
   - outside-org Collaborate blocks save until acknowledgement;
   - no Public or copy-link option exists;
   - a failed save leaves the dialog and draft intact with an inline error.
4. Sign in as a View recipient and verify the shared row says `Shared with you · View`; Details/status/run history are available; Edit, Pause/Resume, Run now, Delete, and sharing controls are absent.
5. Sign in as a Collaborate recipient and verify the row says `Shared with you · Collaborate`; Edit, Pause/Resume, and Run now work; Delete and sharing controls are absent.
6. As Collaborate, run now and inspect the durable run/details plus server logs to prove execution used the original creator identity, not the collaborator. Confirm the next scheduled run is unchanged.
7. As the owner, revoke the explicit grant and verify the recipient loses the row after sync/refetch. Remove or simulate removal of organization membership only through an existing approved test fixture, then verify organization visibility disappears.
8. Open a legacy organization-owned job with no overlay and verify it appears as Organization without any migration prompt or definition rewrite.
9. Force or safely simulate a mutation failure and verify pause/edit/sharing optimistic state rolls back exactly and the error is inline.
10. Inspect browser console and network for unexpected errors or failed 4xx/5xx requests during every role flow. Expected authorization rejections used by negative tests must show the intended typed error and no partial write.
11. Stop the dev process after QA using the environment's normal server controls; do not add server commands or credentials to source/docs.

**Verification checkpoint:**

Capture a concise QA record containing:

- tested app URL/path and build identifier;
- owner, in-org View, explicit View, and explicit Collaborate scenarios using redacted/synthetic test-account labels;
- before/after access labels and visible controls;
- outside-org acknowledgement rejection then success;
- creator identity observed for collaborator run-now;
- legacy compatibility observation;
- optimistic rollback observation;
- console/network result.

**Expected result:** all role and sharing flows match the approved design in the real authenticated UI; creator-bound execution is proven end-to-end; no public flow is reachable; no unexpected console or network error remains.

## Final Completion Checklist

- [ ] One access-aware Automations list replaces Personal/Organization sections.
- [ ] Row labels and owned specific-user count/avatars are correct.
- [ ] Personal, Organization, and Specific people are mutually exclusive and atomic.
- [ ] View and Collaborate permissions are enforced server-side and reflected in UI.
- [ ] Only Owner can delete or manage sharing.
- [ ] Any existing account can be selected; outside-org accounts are labeled.
- [ ] Outside-org Collaborate requires explicit acknowledgement.
- [ ] Public links and public visibility are absent and rejected.
- [ ] `jobs/*.md` remains the definition source of truth.
- [ ] Sharing overlay is additive, resource-id keyed, indexed, and dialect-portable.
- [ ] Legacy organization-owned jobs remain visible without destructive migration.
- [ ] Agent and UI call the same access/write services.
- [ ] Definition/sharing/delete writes are atomic and fail loudly.
- [ ] Optimistic updates have exact rollback and inline errors.
- [ ] Schedule, event, and manual acquisition are unchanged.
- [ ] Every run remains bound to the immutable creator.
- [ ] Canonical skill, English docs, all localized automation docs, and i18n catalog are updated.
- [ ] `@agent-native/core` changeset is present without a manual version bump.
- [ ] Focused tests, package checks, i18n/workspace/security guards, and `pnpm prep` pass.
- [ ] Authenticated multi-account browser QA passes with clean console/network output.
