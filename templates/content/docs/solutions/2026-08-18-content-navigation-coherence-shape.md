# Content navigation coherence: ordered cache-boundary repairs

## Summary

Four durable reports describe navigation that temporarily disagrees with
committed Content state: the tree blanks after page creation, an MCP-created
file does not appear without reload, a deleted page remains briefly, and a new
pin takes seconds to appear. They are related as user experience, but current
repository evidence does **not** support one four-symptom implementation lane.

Creation, deletion, and cross-surface MCP creation all converge on the complete
`list-documents` action query that supplies the document tree. Pinning does not:
the visible Pinned section is rendered from the Favorites system database's
`get-content-database` query. The current code already contains partial or
complete-looking repairs for each path, so historical reports cannot establish
that any particular failure still reproduces on current head.

The smallest compatible first slice is therefore one document-list coherence
lane, beginning with a current-head successful-user-story reproduction matrix.
It may repair only the first demonstrated failure at the existing query/cache
ownership boundary. Pinning stays a separately ordered repair after that lane;
it must not be folded into a generic navigation store or broad invalidation
helper.

## Durable task cluster

- `ab8d5f7f-2fc7-438a-8c63-74a5e1b42b55` — **Fix Content navigation tree
  flicker after page creation**. Two reporter flows and Clips show the entire
  tree disappearing temporarily after creation.
- `7438346b-c717-4e2f-b581-a90cb2c91ab8` — **Refresh Content navigation after
  MCP-created files**. A reporter says supported MCP creation remains absent
  until reload.
- `50c4a2d7-2525-4fa3-8260-6ae3e4beb6f7` — **Remove stale Content navigation
  after page deletion**. A reporter Clip shows confirmed deletion leaving a
  stale entry briefly.
- `a185e193-28fb-4d0d-a014-e79d4ddcb6c3` — **Make Content pinning update the
  sidebar immediately**. The report says pinning takes about three seconds
  while unpinning is nearly immediate.

These are historical reporter observations. This Shape did not replay the
Clips or mutate a live Content runtime, and it does not claim a fresh
reproduction.

## Product context

- Feature: `content.feature.find-your-place-again` (partially implemented).
- Capability: `content.navigation.sidebar` (approved shape).
- User workflow: while Content is open, create, externally create, delete, pin,
  or unpin a Page and continue navigating without the sidebar blanking, lagging,
  or presenting stale success.
- Product contract preserved: the sidebar is a personal navigation projection,
  not object parentage or a second source of truth. Personal pins must not
  reparent Pages or alter Database membership beyond the Favorites reference.
- Change classification: contract repair if a current-head reproduction fails;
  verification-only closure for any historical symptom that current evidence
  proves already repaired.

## Current architecture and demonstrated callers

### Document-tree projection

`DocumentSidebar` calls `useDocuments()`. That hook owns the stable
`["action", "list-documents", undefined]` query and refuses to return a clipped
paginated list as complete. The sidebar derives local-file and database trees
from that one complete document list.

Demonstrated callers entering this projection:

1. **Sidebar page creation.** `handleCreatePage` calls the shared
   `create-document` Action. Ordinary SQL creation and local-file creation
   backed by a Files database insert a temporary document into
   `LIST_DOCUMENTS_QUERY_KEY`; direct local-file creation without that
   database waits for write-back before navigation.
2. **Sidebar deletion.** `handleDelete` computes the deleted subtree, removes
   those rows from `LIST_DOCUMENTS_QUERY_KEY`, removes per-document queries,
   and chooses a safe remaining route before calling `delete-document` or
   `delete-content-database`. Success and failure both refetch the list; failure
   does not restore a captured list snapshot directly.
3. **MCP/tool creation.** Mutating Action execution emits a durable
   action-change marker. Root `useDbSync()` receives action events and the core
   sync hook invalidates active `["action"]` queries, including
   `list-documents`, while preserving a trailing refresh when an older read is
   already in flight. The framework already intends this to be the cross-tab,
   agent, script, and MCP convergence seam.

### Pinned projection

`DocumentSidebar` obtains `favoritesDatabaseId` from `list-content-spaces`,
reads the Pinned section through `useContentDatabaseById(favoritesDatabaseId)`,
and renders its `ContentDatabaseItem` rows. Pin/unpin calls `update-document`
with `isFavorite`.

`useUpdateDocument` optimistically patches per-document, `list-documents`, and
every cached `get-content-database` response and restores captured snapshots on
error. For a Favorites database, setting `isFavorite: false` removes an
existing row immediately. Setting it to `true` can only patch an item already
present; it cannot synthesize the missing Favorites membership row. This
directly predicts the reported asymmetry—unpin is immediate while pin waits for
the database query to refetch—but remains an inference until reproduced on
current head.

### Navigation and application state

Route selection (`activeDocumentId`, React Router navigation, selected Content
space, expanded nodes, and persisted sidebar expansion) controls which existing
projection is open. It does not own document-list membership or Favorites
membership. No evidence supports moving these four repairs into application
state or creating a new navigation store.

## Architecture grounding and fit

### Direct evidence

- `templates/content/app/components/sidebar/DocumentSidebar.tsx` renders the
  tree from `useDocuments`, optimistically removes deleted subtrees, and renders
  Pinned from the Favorites `get-content-database` response.
- `templates/content/app/hooks/use-documents.ts` owns the complete-list query,
  document cache patches, optimistic favorite updates, rollback snapshots, and
  explicit document/list/database invalidation.
- `templates/content/app/hooks/use-content-database.ts` owns database response
  caches and existing optimistic database-item movement.
- `templates/content/app/hooks/use-db-sync.ts` installs the Content root's core
  database/action synchronization.
- `packages/core/src/client/use-db-sync.ts`, action routes, CLI runner, and
  production-agent paths establish action-change events as the intended
  cross-surface invalidation seam.
- The four Bowerbird notes preserve the reporter observations, distinct outcome
  boundaries, and done conditions.

### Inferences to test

- The creation report may arise from a loading-state transition or list-cache
  replacement around ordinary SQL creation, but invalidation alone does not
  prove that cause.
- The deletion report may reflect an older implementation, a refetch race, a
  content-database deletion path, or rollback behavior; current optimistic
  removal means the historical Clip is not current-head proof.
- MCP visibility should converge through action-change invalidation; if it does
  not, the first missing boundary may be marker publication, delivery/cursor
  replay, event scoping, or the list refetch—not necessarily React Query.
- Pin latency is likely the absent optimistic Favorites membership row, not the
  document-list query or navigation state.

### Ownership boundaries

- Actions and SQL own committed Page and Favorites membership state.
- `useDocuments` and `LIST_DOCUMENTS_QUERY_KEY` own the complete document-list
  client projection.
- `get-content-database` caches own Favorites rows and order.
- Core `useDbSync` plus action-change markers own cross-surface freshness
  signaling; Content may configure or narrowly consume that seam but must not
  add an MCP-only refresh channel.
- React Router and Content sidebar state own route, selection, and expansion,
  not object membership.

### Legacy contracts that must remain unchanged

- `list-documents` exhaustion remains explicit; absent, unreadable, clipped,
  and successfully empty results stay distinguishable.
- The dedicated `get-document` response remains authoritative for editable
  bodies; list/database snapshots must not seed a body as fresh.
- Local-file optimistic creation and write-back behavior remain intact.
- Deletes navigate safely, remove the full subtree, and roll back visibly on
  failure.
- Pinning remains personal and access-scoped, with truthful persistence,
  rollback, and no Page reparenting.
- Action-change sync remains generic across browser, MCP, agent, CLI, and other
  supported Action callers; no provider- or MCP-specific twin path is added.
- Broad bare-action invalidation is not added to high-volume paths that already
  own narrow invalidation.

### Smallest compatible delta

First, characterize all three document-list flows against one mounted sidebar
and the real supported interfaces. If a document-list symptom fails, fix only
the earliest demonstrated break in the existing Action -> action-change or
mutation lifecycle -> `LIST_DOCUMENTS_QUERY_KEY` -> derived tree chain. Preserve
the previous successful list while a replacement read is pending and use exact
optimistic patch/rollback only where the failing flow requires it.

Do not design a generic `navigation-coherence` cache, an application-state copy,
or a new subscription. Existing ownership is already specific enough.

### Deferred capabilities

- Optimistic construction of a new Favorites `ContentDatabaseItem` and its
  exact rollback/reconciliation strategy.
- Dynamic Recent/Shared sections, generalized personal References, and the
  complete `content.navigation.sidebar` Capability.
- Session restoration, view-instance state, local-folder watch behavior, and
  provider-source hydration.
- Refactoring every mutation to a generalized normalized entity cache.

### Reversibility

The first slice is restricted to current query keys, mutation callbacks, sync
configuration, and focused regression coverage. It adds no schema, route,
protocol, source-of-truth, or product vocabulary and can be reverted without
data migration.

### Unresolved owner questions

None. Current code and product records settle the public boundaries; the
remaining uncertainty is empirical current-head behavior for Work to establish.

## Implementation-lane decision

Use **two separately ordered repair lanes**, not one four-symptom lane:

1. **Document-list coherence lane (first).** Treat creation, deletion, and MCP
   creation as one investigation/proof lane because they share the same rendered
   query boundary. Within it, repair only symptoms that reproduce, in this
   order: creation flicker, deletion success/rollback, then MCP cross-surface
   convergence. One fix may close siblings only when the complete acceptance
   matrix proves that exact shared delta.
2. **Favorites membership lane (second).** Shape/implement immediate pin and
   unpin behavior at the Favorites database cache boundary. It may reuse
   existing database-cache helpers, but it is not coupled to the first lane's
   document-list or sync repair and should not delay it.

This ordering puts the highest-confidence shared boundary first while avoiding
a four-task PR whose mechanism and proof surface would be ambiguous.

## Explicit exclusions

- No shipping-code edit, dependency, schema, migration, branch operation,
  commit, push, pull request, deployment, feature-flag change, merge, or
  Bowerbird status mutation is authorized by this Shape.
- No new navigation store, event bus, subscription, raw REST endpoint, or MCP-
  specific refresh action.
- No redesign of the sidebar, hierarchy, Content spaces, Home, Recent, Shared,
  session restore, or database Views.
- No claim that historical reports reproduce on current head.
- No automatic consolidation or completion of the four Bowerbird tasks; Work
  must reconcile each only from exact current proof.

## Successful-user-story acceptance plan

Story `content-navigation-document-list-coherence-v1`:

> With an existing populated Content sidebar open, a person can create and
> delete a Page while a supported Content MCP caller can create another Page;
> throughout those changes the existing tree never blanks, committed additions
> appear without reload, confirmed deletions disappear immediately with safe
> navigation, failed deletion restores the prior truthful state, and incomplete
> reads never masquerade as an empty workspace.

Required assertions:

1. Starting from at least two visible Pages, ordinary UI page creation keeps the
   pre-existing rows visible continuously and adds/navigates to exactly one new
   Page after success.
2. Failed UI creation restores the exact prior tree and route with an explicit
   error; it leaves no optimistic row or stale page query.
3. Supported MCP creation in the same workspace appears in the already-open
   sidebar without manual reload and without duplicate rows.
4. A confirmed UI deletion removes the Page and descendants immediately and
   selects a deterministic safe remaining destination.
5. A failed deletion restores the exact prior tree and active route and exposes
   the failure instead of presenting deletion success.
6. During slow/in-flight replacement reads, the last complete successful list
   stays visible; unavailable, unauthorized, inconsistent-pagination, and
   successfully empty results remain distinct.
7. The same flows do not regress local-file creation, per-document body
   authority, access scoping, or full-list pagination.

Acceptance policy:

- Modality: `real-interface` joined with focused automated regression coverage.
- Independence: `preferred`.
- Custody: `same-context-allowed`.
- Interface: the real Content UI for UI create/delete plus the supported
  Content MCP Action surface for cross-surface creation, against an isolated
  local or branch-preview workspace with task-owned disposable Pages.
- Rationale: the defect is interaction timing across two real callers, so unit
  tests alone are insufficient. Alice did not require tester-owned independent
  custody; same-context evidence is proportionate, with technical review and
  automated failure/rollback coverage.

Work must declare exact disposable Page IDs and baseline tree state before
mutation, delete every created Page, and prove independent absence before
acceptance can be satisfied.

The second Favorites lane retains its own acceptance story from Bowerbird:
pin and unpin update immediately, success reconciles to persisted Favorites
membership, failure restores the prior state with an explicit error, and
focused plus real-interface coverage exercises both directions. That story is
not part of the first Work grant.

## Architecture fingerprint — frozen five

```yaml
authoritySchemaVersion: 3
stage: shape
authority-source: >-
  Delegated request from Codex thread 01a00f83-f02d-7b42-9a31-ff18c5a5eded:
  shape the four named Content navigation tasks only; implementation is not
  authorized.
authorized-scope:
  repositories:
    - /Users/alicemoore/.codex/worktrees/e19d/agent-native
  product-surfaces:
    - Content document-tree navigation
  outcome: >-
    Prove and repair current-head coherence for UI-created, UI-deleted, and
    MCP-created Pages at the existing complete document-list boundary without
    coupling the separate Favorites membership repair.
allowed-mutations:
  - artifact-write
write-targets:
  artifacts:
    - templates/content/docs/solutions/2026-08-18-content-navigation-coherence-shape.md
governing-artifact:
  path: templates/content/docs/solutions/2026-08-18-content-navigation-coherence-shape.md
  revision: shape-v1-2026-08-18
architecture-fingerprint:
  outcome: >-
    Existing Content navigation remains truthful and continuously usable while
    UI and MCP Page mutations converge through the document-list projection.
  shipping-surfaces:
    - id: content-document-list-navigation
      repository: builderio/agent-native
      product-surface: templates/content document-tree sidebar and Action sync
      constituency: authorized Content users using UI and supported MCP callers
      durable-destination: agent-native origin/main Content template
      integration-action: merge
  governing-architecture: >-
    Actions and SQL remain authoritative; UI-local mutation lifecycles and the
    existing core action-change sync seam converge the complete
    LIST_DOCUMENTS_QUERY_KEY projection, while route/application state owns
    selection only and Favorites remains a separate database projection.
  acceptance-story:
    id: content-navigation-document-list-coherence-v1
    summary: >-
      A populated open sidebar stays visible and converges without reload across
      UI create, UI delete success and rollback, and supported MCP creation.
    required-assertions:
      - UI creation preserves existing rows and adds exactly one committed Page.
      - Creation failure restores the exact prior tree and route.
      - Supported MCP creation appears without reload or duplication.
      - Deletion removes the subtree and selects a safe destination immediately.
      - Deletion failure restores the exact prior tree and active route.
      - Slow, failed, unreadable, clipped, and empty reads remain distinguishable.
      - Local-file behavior, body authority, access scope, and pagination remain intact.
    acceptance-policy:
      modality: real-interface
      independence: preferred
      custody: same-context-allowed
      interface: >-
        Real Content UI plus supported Content MCP Actions in an isolated local
        or branch-preview workspace with declared disposable Pages.
      rationale: >-
        Timing and cross-caller convergence require real interfaces; Alice did
        not make independent tester custody part of the story.
  risk-strategy:
    kind: system-ready
    production-validation-after-merge: false
architecture-grounding:
  applicability: required
  reason: >-
    The lane crosses Content mutation hooks and the shared framework
    action-change synchronization seam.
  status: grounded
  demonstrated-callers:
    - DocumentSidebar UI create through create-document.
    - DocumentSidebar UI delete through delete-document or delete-content-database.
    - Supported Content MCP/tool create through the same mutating Action surface.
  existing-primitives:
    - useDocuments and LIST_DOCUMENTS_QUERY_KEY complete-list cache.
    - DocumentSidebar optimistic local-file create and subtree delete patches.
    - useUpdateDocument cache snapshots and rollback.
    - core useDbSync action-change invalidation with trailing refresh.
  ownership-boundaries:
    - SQL and Actions own committed objects and memberships.
    - list-documents owns the complete tree projection.
    - get-content-database owns Favorites membership rows.
    - action-change sync owns cross-surface freshness delivery.
    - Router and sidebar state own selection and expansion only.
  legacy-contracts:
    - Complete-list pagination fails loudly rather than returning a clipped success.
    - get-document remains authoritative for editable bodies.
    - Local-file optimistic creation and write-back remain intact.
    - Delete success, rollback, and safe navigation remain truthful.
    - Action-change stays caller-generic and access-scoped.
  shared-vocabulary:
    - document-list projection
    - Favorites membership projection
    - action-change sync seam
  smallest-compatible-delta: >-
    Reproduce the three document-list flows on current head, then repair only
    the earliest demonstrated break inside the existing mutation/action-change
    to LIST_DOCUMENTS_QUERY_KEY chain, preserving the last complete list and
    adding exact rollback where the failed story requires it.
  deferred-capabilities:
    - Immediate optimistic Favorites membership creation and rollback.
    - Full personal References and dynamic sidebar sections.
    - Session restoration, Home, Recent, Shared, and provider/local-source sync.
  reversibility: >-
    No schema or public contract changes; the slice stays within existing query
    keys, mutation callbacks, sync configuration, and regression coverage.
  direct-evidence:
    - templates/content/app/components/sidebar/DocumentSidebar.tsx
    - templates/content/app/hooks/use-documents.ts
    - templates/content/app/hooks/use-content-database.ts
    - templates/content/app/hooks/use-db-sync.ts
    - packages/core/src/client/use-db-sync.ts
    - templates/content/docs/product/capabilities/content.navigation.sidebar.md
    - the four named Bowerbird task notes
  inferences:
    - Pin asymmetry likely comes from inability to add an absent optimistic Favorites row.
    - Historical creation, deletion, and MCP failures may have changed on current head.
  unresolved-owner-questions: []
delegation-ceiling: []
product-boundary-gates:
  agent-native-public-constituency: >-
    Content is a public template surface for authorized end users and supported
    MCP callers; the repository evidence names both callers and one shared Action contract.
  bowerbird-product-boundary: >-
    Four existing tasks remain separate durable outcomes; this artifact orders
    their repair and does not mutate or collapse their status.
acceptance-state:
  status: satisfied
  summary: >-
    Work preserves the complete list-cache shape during optimistic creation and
    restores exact list and document snapshots before background reconciliation
    on failed create/delete. Sixty focused tests, typecheck, all 55 guards, a
    production build, real UI creation/deletion, and open-UI Action refresh are
    green. Every declared disposable Page is independently absent after cleanup.
  blockers: []
  last-land-packet: null
ledger-revision: content-navigation-coherence-work-v1
status: review-ready
```

## Work evidence — 2026-08-18

- Exact branch: `codex/content-navigation-coherence` from
  `origin/main@39383b558b881269a1387d7cfcc94eba8826250b`.
- Smallest delta: preserve the existing list-cache envelope during optimistic
  creation; restore the prior complete list, affected per-document snapshots,
  and prior route synchronously on mutation failure; remove the optimistic
  list query when no prior snapshot existed.
- Cross-surface result: two Action-created Pages appeared in the already-open
  real sidebar without reload or duplication, so no new MCP channel or core
  sync change was necessary.
- Real UI result: with `nav-baseline-a` and `nav-baseline-b` visible, creating
  `nav-ui-create` kept both baseline rows visible and navigated to exactly one
  new Page. Confirmed deletion removed it immediately and navigated to the
  surviving `Dev's workspace` surface while both baseline rows remained.
- Automated result: 60 focused Content tests pass, including populated and
  absent list rollback, prior-route restoration, complete-list pagination, and
  deleted list/per-document snapshot restoration. The 39 focused core sync
  tests also pass.
- Repository result: Content typecheck, `git diff --check`, all 55 guards, and
  the Content production build pass. The build reports pre-existing doctor and
  local-production-configuration warnings but completes successfully.
- Review result: an independent read-only review found two rollback holes
  (prior-route restoration and absent-snapshot semantics) plus weak deletion
  coverage; all three were corrected and covered before acceptance.
- Cleanup receipt: `nav-baseline-a`, `nav-baseline-b`, and
  `thmKsbqMzOAJ` (`nav-ui-create`) were permanently deleted. The open sidebar
  reported zero matching rows, SQLite reported zero matching records, port
  `8086` had no listener after shutdown, and
  `/tmp/content-nav-coherence.CFh4Jg` was moved to Trash.
- Compute receipt: framework remote preflight could not run because Tailscale
  was stopped, so the supported Mac fallback was used; no remote workload or
  manifest was created.

## Precise Work handoff

Invoke:

`/work templates/content/docs/solutions/2026-08-18-content-navigation-coherence-shape.md`

Work is authorized only after that explicit invocation. It should begin with
the document-list acceptance matrix, preserve the exact frozen fingerprint,
and stop rather than absorbing the deferred Favorites lane. When the first lane
is proven and review-ready, reconcile each of the three document-list Bowerbird
tasks independently from its evidence; leave the pinning task open for its
separate ordered repair.
