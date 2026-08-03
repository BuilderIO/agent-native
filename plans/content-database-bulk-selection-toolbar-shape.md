# Content database bulk-selection visibility and permission accuracy

## Lifecycle authority

```yaml
stage: work
authority-source: "Alice approved option 2 and shape-r4 on 2026-07-30, restoring the prior $work grant"
authorized-scope:
  repositories: [BuilderIO/agent-native]
  product-surfaces: [Agent Native Content database row actions]
  outcome: Permission-accurate database bulk actions that remain visible in wide tables
allowed-mutations: [artifact-write, branch, commit, push, pull-request]
governing-artifact:
  path: plans/content-database-bulk-selection-toolbar-shape.md
  revision: shape-r4-approved
ledger-revision: content-bulk-selection-shape-r4
status: active
```

`WORK RESUMED — SHAPE-R4 APPROVED`

The former `ac1b` worktree and its untracked shaping file are no longer present.
This file reconstructs the approved `shape-r3` boundary from the task record and
records the new material delta found on refreshed `origin/main` before any code
edit.

## Approved shape-r3 fingerprint

- **Outcome:** keep the selected-row toolbar visible while the table scrolls;
  show mutation controls only when the same viewer-scoped authorization used by
  the Action permits the operation for the whole selection.
- **Shipping surface:** public Agent Native Content database table and row-action
  surfaces for viewers and editors in Safari and supported desktop browsers.
- **Architecture:** fixed Database roles (**Can view / Can comment / Can edit
  entries / Can edit database / Full access**) expand to internal capabilities;
  object, row/Page, workspace, Property, and source restrictions may narrow but
  never widen them. UI, Actions, agents, and APIs share one authorization
  decision and fail closed on missing or stale capability data.
- **Acceptance:** viewers retain non-mutating selection count and Clear; entry
  editors may edit/duplicate when permitted but cannot delete; Database editors
  may delete only when effective authority covers the whole selection; stale
  calls fail without mutation; Favorites Remove remains membership-only;
  technical, real-Safari, and slow experience-audit evidence are required.
- **Risk:** system-ready, no feature flag, no production-validation-after-merge.

## Material delta discovered during Work

Refreshed `origin/main` at
`392440ec90d619df3b364cc3cb1cfa409aee1baa` contains an approved, July 29
Database capability contract stating:

> Removing a Page from a Database removes that membership and its
> membership-local values; it does not delete the Page or its other
> memberships.

Current implementation does something materially different:

- the bulk `delete-database-items` Action recursively moves every selected Page
  and its descendants to Trash and removes all Database memberships;
- the single-row menu calls `delete-document`, labels the operation **Delete
  row**, and warns that the Page and sub-pages will be permanently deleted;
- Favorites is the one existing special case that removes only membership;
- current sharing storage still exposes the generic internal roles
  `viewer/editor/admin`; the approved Database role vocabulary is product shape,
  not yet a complete implementation.

The r3 phrase “delete a row” therefore hides two different user outcomes:

1. remove this Page's membership in the current Database; or
2. delete the Page itself, including consequences outside this Database.

Choosing between them changes the mutation, permission boundary, recovery
story, UI language, Action result, and multi-membership behavior. Work cannot
quietly choose.

## Options

### 1. Preserve recursive Page deletion and only repair affordance permissions

Keep **Delete row**, require the current equivalent of **Can edit database** plus
Page-delete authority for every selected Page, and hide the action otherwise.

- smallest code change;
- fixes Alice's immediate view-only affordance failure;
- conflicts with the approved Database contract and makes a Database operation
  destroy material outside the current membership.

### 2. Make ordinary row removal membership-only (recommended)

Rename the operation **Remove from database** and remove only the selected
membership plus values owned by that Database. The Page, descendants, other
memberships, and unrelated values survive. Keep destructive Page deletion on
the Page's own action surface under Page-level authority.

- matches the approved Database object and fixed-role contracts;
- makes **Can edit database** the authority for Database membership removal;
- keeps Page deletion a separate, honestly named consequence;
- requires the bulk and single-row Database surfaces to change together so the
  product does not offer two meanings for “row deletion.”

### 3. Offer both Remove from database and Delete page

Expose two explicit actions with separate confirmations and capabilities.

- preserves both jobs in context;
- adds consequential choice and UI density before evidence shows people need
  destructive Page deletion from the Database surface;
- creates a larger first slice and a sharper accidental-deletion hazard.

## Approved shape-r4 fingerprint

- **Outcome:** selected-row controls remain visible and permission-accurate;
  ordinary Database row removal removes membership without deleting the Page.
- **Shipping surface:** public Agent Native Content table bulk toolbar and
  single-row action menu, plus the shared row-removal Action used by people and
  agents. Favorites keeps its existing personal-membership behavior.
- **Architecture:** use the approved fixed Database role grammar. **Can edit
  database** may remove memberships; **Can edit entries** may create/update but
  not remove them; **Can view / Can comment** see no mutation controls. Effective
  operation capabilities are viewer-scoped and narrowed by object, workspace,
  source, and row/Page policies. Page deletion remains a distinct Page Action
  under Page authority. No client-only permission system.
- **Acceptance:** use the replacement story below.
- **Risk:** system-ready, no feature flag, no production-validation-after-merge.

## Replacement acceptance story

Given a Database containing Pages that may also belong elsewhere:

1. A **Can view** or **Can comment** collaborator can select rows for bounded
   application/agent context and sees only selection count and Clear. No Edit,
   Duplicate, Remove, row-create, or structural mutation control appears.
2. A **Can edit entries** collaborator sees only whole-selection operations they
   can complete, including Edit and eligible Duplicate, but not **Remove from
   database**.
3. A **Can edit database** collaborator with effective authority for every
   selected membership sees **Remove from database**. Confirmation names the
   membership consequence and does not claim that the Page will be deleted.
4. Removing one or many rows atomically deletes only the target
   `content_database_items` memberships and values belonging to the target
   Database, renumbers survivors, preserves each Page, descendants, other
   memberships, unrelated Property values, access grants, and content, and
   returns addressable removed-membership identifiers.
5. Mixed, missing, stale, source-read-only, or policy-restricted capability data
   fails closed in the UI. A forced Action or agent call returns the same typed
   denial before any write.
6. Destructive Page deletion remains available only through the separately
   named Page action with Page-level authority and its own consequence language;
   the Database toolbar does not smuggle that power into membership removal.
7. Favorites continues to remove personal membership without requiring
   authority over the underlying Page.
8. The selection bar stays anchored while wide table content scrolls; narrow
   widths, keyboard access, accessible names, cancellation, reload, and Safari
   are covered.
9. Deterministic tests prove fixed-role mapping, membership/value scoping,
   multi-membership survival, atomicity/idempotency, stale denial, no unintended
   writes, and UI/Action/agent authorization parity. Independent technical
   review covers the final authorization/destructive-behavior diff, followed by
   independent real-interface QA.

## Architecture grounding

- **Demonstrated caller:** Alice's view-only Safari Database selection, where a
  destructive control appeared and the Action later denied access.
- **Existing primitives:** shared `resolveAccess` / `assertAccess`, typed Actions,
  `content_database_items` memberships, row/Page access metadata, application
  selection state, and the current confirmation/dialog components.
- **Ownership boundary:** Database Actions own membership mutation; Page Actions
  own Page deletion; the shared access layer owns effective authorization.
- **Legacy contracts:** Favorites remains membership-only; selection remains
  non-mutating context; direct stale calls remain server-denied.
- **Smallest compatible delta:** one membership-removal Action contract consumed
  by bulk and single-row Database surfaces, plus the already-shaped toolbar
  placement fix.
- **Deferred:** custom roles, a client-side capability engine, bulk destructive
  Page deletion from Database context, access-granting Views, and schema-wide
  permission redesign.
- **Reversibility:** membership removal is narrower than Page deletion and does
  not destroy the canonical Page; no feature flag is proposed because complete
  system-ready evidence remains required.
- **Direct evidence:**
  `templates/content/docs/product/capabilities/content.object.database.md`,
  `templates/content/docs/product/capabilities/content.access.page-database.md`,
  `templates/content/actions/delete-database-items.ts`,
  `templates/content/actions/delete-document.ts`, and
  `templates/content/app/components/editor/database/shared.tsx` on refreshed
  `origin/main`.
- **Unresolved owner question:** whether ordinary Database “row deletion” means
  membership removal or recursive Page deletion. The approved Database contract
  says membership removal; Alice's decision binds this implementation slice.

## Decision

Alice approved option 2 and the replacement `shape-r4` story on July 30, 2026.
It preserves the Page and makes the Database boundary honest: removing a thing
from a view of work should not quietly erase the thing from the world.
