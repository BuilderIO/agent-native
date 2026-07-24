# Database page properties switch to Files fields after a Select edit

## Answer

The bug is reproduced and diagnosed. A database row can belong both to the
database the user is viewing and to its workspace's canonical Files database.
The sidebar preview initially warms its property cache from the viewed database,
but a property save invalidates that cache and refetches properties using only
the page id. The server then chooses one of the page's database memberships
without receiving or ordering by the active database. When it chooses Files, the
preview replaces the user's fields with the Files system fields `Kind`,
`Parent`, and `Source`.

The colored Select interaction is the reliable trigger because a successful
`set-document-property` invalidates `list-document-properties`. The color option
implementation is not the cause.

This is a context-loss bug across the action boundary, not a Builder hydration
bug and not a continuation of the draft-conflict banner fixed by PR #2303.

## Evidence

### Slack report

The scoped thread begins at
[Tim's July 24 reply](https://builder-internal.slack.com/archives/C0ATH3CCZT4/p1784905437991239?thread_ts=1784658820.437679&cid=C0ATH3CCZT4).
From that reply downward:

- The original page-body interruption appears resolved.
- In the database sidebar preview, choosing a colored Select value can replace
  the database's fields with unclickable `Kind`, `Parent`, and `Source`.
- `+ Add property` remains visible.
- Opening the full page shows no fields above the body.
- Tim correctly suspected his recent Select-color work because selecting a
  colored value triggers the transition, but the evidence below excludes the
  palette code as the cause.

The two exact Slack screenshots were later recovered through the signed-in
Slack desktop app and visually inspected. The preview image shows the page
`Agencies` with only `Kind`, `Parent`, and `Source`, each empty, followed by an
enabled-looking `+ Add property` control. The full-page image shows the same
title and body with no properties above the body. Together they corroborate the
reported schema replacement and distinguish it from the intentional full-page
Info-rail presentation. They do not show the click sequence, so the disposable
dual-membership reproduction remains the causal proof.

### Executed database reproduction

A disposable SQLite fixture was migrated and run through Content's real
Drizzle property resolvers under Node 24 in the dependency-equipped canonical
checkout at `a57951438`. The cache-seeding and ambiguous membership-resolver
contract exercised there is unchanged in the inspected current source at
`cd30194b2`. The fixture created:

- one row page;
- a Files membership whose properties were `Kind`, `Parent`, and `Source`; and
- a custom database membership whose colored Select property was `Status`.

The same page produced:

```json
{
  "cachedPreviewSchema": ["Status"],
  "refetchedPageOnlySchema": ["Kind", "Parent", "Source"],
  "memberships": ["files-db", "custom-db"]
}
```

The fixture and its SQLite sidecars were removed after the run.

The existing cache-seeding unit test also passed under the repository's compiled
runtime:

```text
app/hooks/use-documents.test.ts
1 passed, 14 skipped
```

That test confirms that opening a database row warms the
`list-document-properties` cache with the row's contextual database and
properties.

### Causal code path

1. The preview seeds `list-document-properties` from the active database row,
   including that row's exact `databaseId`
   ([use-documents.ts](../../app/hooks/use-documents.ts#L242),
   [DatabaseView.tsx](../../app/components/editor/database/DatabaseView.tsx#L4346)).
   The cache key itself contains only `documentId`
   ([use-documents.ts](../../app/hooks/use-documents.ts#L42)).
2. `DocumentProperties` receives `databaseDocumentId`, but its read hook drops
   that context and calls `list-document-properties` with only `documentId`
   ([DocumentProperties.tsx](../../app/components/editor/DocumentProperties.tsx#L798),
   [use-document-properties.ts](../../app/hooks/use-document-properties.ts#L25)).
3. A successful Select value save invalidates that page-only query
   ([use-document-properties.ts](../../app/hooks/use-document-properties.ts#L102)).
4. `list-document-properties` accepts only `documentId`
   ([list-document-properties.ts](../../actions/list-document-properties.ts#L12)).
   Its resolver selects the first membership without an `orderBy` or an active
   database id
   ([\_property-utils.ts](../../actions/_property-utils.ts#L103)).
5. The refetched Files definitions render as non-editable because system-role
   properties deliberately suppress management and value controls
   ([DocumentProperties.tsx](../../app/components/editor/DocumentProperties.tsx#L930)).

There is already a safer membership preference in the separate document-read
path: `getDatabaseItemByDocumentId` orders non-system databases ahead of system
databases ([\_database-utils.ts](../../actions/_database-utils.ts#L732)). The
property resolver does not share it. Copying that heuristic would reduce the
Files symptom but would still be wrong for a page in multiple user databases;
the active database must be explicit.

### Data-integrity edge

Tim was right not to click `+ Add property`. The control is rendered from the
refetched database response, but it passes only `documentId`
([DocumentProperties.tsx](../../app/components/editor/DocumentProperties.tsx#L848)).
`configure-document-property` resolves a database from that ambiguous page id
before inserting the definition
([configure-document-property.ts](../../actions/configure-document-property.ts#L91)).
In the reproduced state, a new property can therefore target Files rather than
the database the user is looking at. There is no evidence Tim clicked it or that
production data was changed.

### Full-page behavior

Not showing database fields directly above the full-page body is currently
intentional: the full-page surface renders them in the Info rail
([DocumentInfoPanel.tsx](../../app/components/editor/DocumentInfoPanel.tsx#L21)).
However, the Info rail uses the same page-only read hook, so its schema can still
be wrong. Opening a page from a database should preserve the originating
database context through the route/application state and into the Info rail.

## Inferences

- PR #2310 made the Select interaction more visible and optimized, but it did
  not introduce the server's page-only membership resolver. The trigger and
  cause merely happen to shake hands.
- PR #2344 correctly narrowed property-save invalidation and began passing the
  parent database document id into value-mutation cache work. It did not add the
  active database id to the property read action or its cache key, so this
  context switch remains.
- Pages created in or later added to more than one database are the affected
  constituency. Single-membership pages cannot exhibit this schema swap.

## Uncertainties

- A signed-in Builder workspace browser session was not available in this task,
  so production UI acceptance is not claimed.
- The exact membership insertion order on Tim's page was not inspected. It is
  unnecessary to establish the defect because the API is under-specified for
  any multi-membership page, but it would explain why this particular page
  resolves to Files after refetch.

## Recommendation

Make property database context explicit end to end:

1. Add exact `databaseId` context to `list-document-properties` and validate
   that the page is a member of that accessible database.
2. Include `{ documentId, databaseId }` in the query key.
3. Pass the active `databaseId` from `DatabaseItemPreview` to
   `DocumentProperties`, every value/definition mutation, hidden-property
   controls, and `+ Add property`.
4. Preserve the originating database id when `Open Page` navigates, then use it
   in the full-page Info rail.
5. Keep an ordered non-system fallback only for context-free entry points; do
   not treat it as equivalent to explicit context.

Do not patch the color picker or merely add `orderBy` to the ambiguous resolver.
Those would quiet one ghost while leaving the house politely haunted.

## Acceptance story

Given a page that belongs to Files and at least one user database:

1. Opening it from a user database preview shows that database's exact scalar
   and Blocks fields.
2. Selecting and changing colored Select, Status, and Multi-select values keeps
   the same schema before the optimistic update, after the action response, and
   after the invalidated query refetch.
3. `+ Add property`, hidden-property changes, rename/reorder/delete, and value
   edits mutate only the active user database.
4. `Open Page` followed by opening Info shows the same database's fields.
5. Opening the same page from Files shows Files fields, and opening it from a
   second user database shows that second database's fields.
6. A forged or inaccessible `databaseId` fails closed without revealing or
   mutating another database.
7. Real-interface coverage exercises the sidebar preview and full-page Info rail
   in the Builder workspace after deployment.

Visual baseline for steps 1 and 4: the preview must not regress to the recovered
`Agencies` screenshot's `Kind` / `Parent` / `Source` schema when opened from the
user database. The full page may continue to omit properties above the body, as
shown in the recovered comparison, but opening Info must reveal the originating
database's exact fields.

## Shaped implementation boundary

- **Outcome:** preserve the active database's property schema and mutations
  across preview edits and full-page navigation.
- **Shipping surface:** `BuilderIO/agent-native`, Content database preview and
  full-page Info rail, for Content users with multi-membership pages.
- **Durable destination:** the public Content template on the repository's
  integration branch through an ordinary reviewed pull request and later merge.
- **Governing architecture:** actions remain the source of truth; database
  context is explicit, validated, and carried in action/query/navigation state.
- **Public product boundary:** any source-blind Content developer can reproduce
  this with the public SQL schema and a local dual-membership page; it needs no
  Alice-specific vault, machine state, credentials, or private orchestration,
  so the fix belongs in the public template.
- **Risk strategy:** system-ready, with a fail-closed authorization regression
  and deployed Builder workspace acceptance before calling it shipped; no
  feature flag is necessary for the bounded fix.

## Work evidence

The bounded fix now carries the exact `databaseId` through property reads,
`{ documentId, databaseId }` query keys, definition and value mutations,
preview-to-page navigation, and the full-page Info rail. Explicit context is
validated against both database access and the page's exact membership. A
forged, inaccessible, or wrong-database id fails before either reading fields or
creating a definition. Context-free direct page entry keeps the existing
fallback without treating it as equivalent to a database-originated route.

Automated acceptance under Node 24 is green:

- `pnpm typecheck`;
- 142 focused tests across the property, cache, navigation, and database
  lifecycle surfaces;
- the full Content suite: 151 files passed, 1 skipped; 1,850 tests passed, 3
  expected failures, and 5 skipped; and
- the production build, with only the repository's existing doctor and
  optional dynamic-import warnings.

The database lifecycle regression creates one page in Files and a user
database, proves exact schemas for both contexts, rejects a wrong-database
rename without changing either schema, creates a new property only in the
requested user database, and rejects forged and inaccessible database ids.

A root-run local real-interface pass used the same deterministic membership
shape. It confirmed that `Status` survives green `Active` and orange `Paused`
Select saves and their refetches; `QA Context Note` created from the user
preview appears only in that database; `Open page` preserves
`databaseId=XNtrWT5z3RqJ&databaseDocumentId=Bo14RJXMy0ab`; Info shows the user
fields; Files shows its own `Parent` and `Source` fields without either user
field; and returning to the user database restores both user fields. No console
errors occurred during that pass. The screenshots are stored with the task's
QA artifacts.

Independent real-interface acceptance remains blocked before H1: the tester's
Chrome profile reaches the local sign-in form, while the authenticated
`dev@local.test` session exists only in the root task's in-app browser, which
the independent tester role cannot access. Deployed Builder workspace
acceptance therefore remains open; the root-run evidence is not relabeled as
independent or deployed proof.

## Sources

- Slack thread: channel `C0ATH3CCZT4`, parent `1784658820.437679`, scoped reply
  `1784905437.991239` and descendants.
- Recovered and visually inspected Slack images:
  `tim-colored-select-schema-switch-slack.png` and
  `tim-full-page-fields-slack.png`.
- Current local source at `cd30194b2` (`origin/main`).
- Local reproduction on 2026-07-24 using a disposable migrated SQLite database
  at `a57951438`, cross-checked against the same relevant current-source
  contract at `cd30194b2`.
- Historical comparison: PR #2303 and PR #2344 commits in local Git history.
