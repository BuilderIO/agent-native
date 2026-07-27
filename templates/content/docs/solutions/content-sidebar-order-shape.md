# Content sidebar ordering

> WORK AUTHORIZED
>
> Alice approved this replacement fingerprint by invoking `/work` on July 26, 2026. Implementation is bound to the frozen outcome, three shipping surfaces,
> governing architecture, acceptance story, and system-ready risk strategy.

## Refresher

The first shape recommended custom ordering only for **Pinned**. Alice has now
agreed to the broader product direction:

- Pinned is always personal and custom-orderable.
- Workspace roots are personally custom-orderable.
- Each workspace's Files section offers `Custom`, `Last edited`, `Name`, and
  `Created` order modes.
- `Custom` is personal by default. A future “Save this order for everyone” is an
  explicit shared-view capability, not an implicit consequence of dragging.
- Dragging and its keyboard/menu equivalents reorder sidebar references. They
  never reparent a page, move it between workspaces, change access, or change
  ownership.

The implementation should remain Content-local. There is no current Toolkit
controller for ordered pinned/navigation resources, while Content already has
the required database-membership and personal-view substrate. A shared
headless controller becomes worth proposing after a second non-chat app needs
the same behavior.

This passes the public-constituency gate: a source-blind developer installing
the public Content template receives the same generic workspace navigation,
with no Builder-internal data, identity, or operating assumption required.

## Interaction boundary

```text
NORMAL                         DRAG / POINTER                 KEYBOARD / MENU
┌──────────────────────┐       ┌──────────────────────┐       ┌──────────────────────┐
│ PINNED               │       │ PINNED               │       │ Roadmap          ••• │
│  ⋮⋮ Launch brief     │       │  ⋮⋮ Launch brief     │       │ ┌──────────────────┐ │
│  ⋮⋮ Roadmap          │  →    │  ── drop here ──     │  =    │ │ Move up          │ │
│  ⋮⋮ Research notes   │       │  ⋮⋮ Roadmap          │       │ │ Move down        │ │
└──────────────────────┘       │  ⋮⋮ Research notes   │       │ │ Move to…         │ │
                               └──────────────────────┘       │ └──────────────────┘ │
                                                            └──────────────────────┘

Changes: my Pinned reference order
Does not change: page parent, Files membership, workspace, sharing, or ownership

FILES — CUSTOM                FILES — NAME / LAST EDITED / CREATED
┌──────────────────────┐       ┌──────────────────────┐
│ Order: Custom      ▾ │       │ Order: Name        ▾ │
│  ⋮⋮ Brief            │       │    Brief             │
│  ⋮⋮ Assets           │       │    Launch            │
│  ⋮⋮ Launch           │       │    Assets            │
└──────────────────────┘       └──────────────────────┘
 drag/menu enabled              drag/menu disabled; custom order is preserved
```

For hierarchical Files, reorder is limited to the visible sibling set. A drop
across parent boundaries is rejected; nesting remains an explicit `Move to…`
content operation. If the active view is filtered or grouped, manual reorder is
disabled because hidden/grouped rows make a target position ambiguous.

## Product decisions

| Surface         | Default scope                  | Durable order                                                              | Available modes                    | Manual reorder                             |
| --------------- | ------------------------------ | -------------------------------------------------------------------------- | ---------------------------------- | ------------------------------------------ |
| Pinned          | Current user                   | Personal Pinned database membership `position`                             | Custom                             | Always, when the row is visible            |
| Workspace roots | Current user                   | Personal Workspaces catalog membership `position`                          | Custom                             | Always, when the row is visible            |
| Workspace Files | Current user per database/view | Personal database-view override containing mode and ordered membership IDs | Custom, Last edited, Name, Created | Only in Custom with no active filter/group |

New Pinned items, newly joined workspaces, and new Files memberships append to
the end of the stored custom order. Deleted or inaccessible IDs are ignored on
read and pruned on the next successful write. Switching to a computed mode does
not erase the custom order.

`Home`, `Add workspace`, and `Trash` remain fixed chrome; only workspace roots
inside the Workspaces collection move.

## Current product truth

- Pinned is still internally named Favorites. Its personal system database
  already appends memberships with a `position`, but `list-documents` reduces
  them to a boolean set and the sidebar therefore discards the stored order
  ([`_content-favorites.ts`](../../actions/_content-favorites.ts),
  [`list-documents.ts`](../../actions/list-documents.ts),
  [`document-sidebar-sections.ts`](../../app/components/sidebar/document-sidebar-sections.ts)).
- Workspace roots are already rendered from the signed-in user's Workspaces
  catalog database. Each catalog row has an exact membership item ID and
  position; `ContentFilesSidebarView` already renders that response
  ([`list-content-spaces.ts`](../../actions/list-content-spaces.ts),
  [`DocumentSidebar.tsx`](../../app/components/sidebar/DocumentSidebar.tsx)).
- Each expanded workspace already fetches its Files database and its per-user,
  per-database view overrides. The sidebar applies personal filters and sorts
  without changing the shared saved view
  ([`sidebar.tsx`](../../app/components/editor/database/sidebar.tsx),
  [`_content-database-personal-view.ts`](../../actions/_content-database-personal-view.ts)).
- `move-database-item` atomically resequences membership positions, but it also
  accepts ambiguous `documentId` and performs its read/reorder calculation
  before the transaction. Sidebar callers must use exact `{databaseId, itemId}`
  identity, and the action should be hardened with the existing per-database
  position lock ([`move-database-item.ts`](../../actions/move-database-item.ts),
  [`_position-utils.ts`](../../actions/_position-utils.ts)).
- The active document-tree drag handler calls `move-document`, which changes
  canonical page hierarchy/position. It is deliberately not the persistence
  path for this feature
  ([`DocumentSidebar.tsx`](../../app/components/sidebar/DocumentSidebar.tsx),
  [`move-document.ts`](../../actions/move-document.ts)).
- The general sidebar setting stores expansion only. Ordering does not belong
  there: Pinned and Workspaces already have membership state; Files ordering is
  scoped to a database view
  ([`_content-sidebar-state.ts`](../../actions/_content-sidebar-state.ts)).

No schema migration is required for Pinned or Workspace roots. Files personal
custom order requires a backward-compatible version bump to the existing
personal-view setting schema, not a new SQL table or shared membership rewrite.

## Implementation plan

### 1. Establish one explicit ordering contract

Add shared API types for:

```ts
type OrderedMembershipRef = {
  databaseId: string;
  itemId: string;
  documentId: string;
  position: number;
};

type ContentSidebarOrderMode = "custom" | "last_edited" | "name" | "created";

type ContentSidebarViewOrder = {
  mode: ContentSidebarOrderMode;
  itemIds: string[]; // retained when mode is computed
};
```

The personal database-view override gains optional `sidebarOrder` per view.
Version 2 settings normalize forward with `mode: "custom"` and no saved IDs;
the current membership order is then the fallback. The field is explicitly
sidebar-only so choosing a sidebar order does not silently rewrite the full
database view's personal sort controls.

Primary files:

- [`shared/api.ts`](../../shared/api.ts)
- [`actions/_content-database-personal-view.ts`](../../actions/_content-database-personal-view.ts)
- [`actions/get-content-database-personal-view.ts`](../../actions/get-content-database-personal-view.ts)
- [`actions/update-content-database-personal-view.ts`](../../actions/update-content-database-personal-view.ts)

### 2. Harden the atomic membership move

Extend `move-database-item` so sidebar calls provide `databaseId`, `itemId`, and
the destination position. Validate that the item belongs to that database,
acquire the existing database-position lock, calculate the new order inside the
locked transaction, resequence once, and return the canonical database
response.

Keep legacy `documentId` compatibility for existing callers during this slice,
but do not use it in new sidebar code. Add a later cleanup issue rather than
mixing an unrelated breaking action change into this feature.

The action must preserve its existing Files child-document mirroring where
that remains required by the database editor. Tests must prove Pinned and
Workspaces reference moves do not mutate the underlying content page's
`parentId`, position, sharing, or other memberships.

Primary files:

- [`actions/move-database-item.ts`](../../actions/move-database-item.ts)
- [`actions/_position-utils.ts`](../../actions/_position-utils.ts)
- [`app/hooks/use-content-database.ts`](../../app/hooks/use-content-database.ts)

### 3. Make Pinned and Workspaces consume their real ordered memberships

Render Pinned from `get-content-database(favoritesDatabaseId)` instead of the
favorite-filtered `list-documents` array. This yields exact item identity and
membership order. Keep `isFavorite` on document metadata for commands/search,
but stop treating it as the Pinned list's ordering source.

Workspace roots already render from the Workspaces catalog database. Add drag
and menu reorder using each row's exact catalog membership ID. Also make
`list-content-spaces` deterministic by ordering its joined memberships and
returning catalog position; this keeps the action truthful for agent callers
even though the rendered list comes from `get-content-database`.

For both surfaces, use optimistic cache reorder, one mutation on drop/menu
activation, rollback to the snapshot on failure, a visible toast, and a
canonical refetch. A read-only underlying page remains reorderable in Pinned
because the user owns the personal Pinned membership.

Primary files:

- [`app/components/sidebar/DocumentSidebar.tsx`](../../app/components/sidebar/DocumentSidebar.tsx)
- [`app/components/sidebar/document-sidebar-sections.ts`](../../app/components/sidebar/document-sidebar-sections.ts)
- [`actions/list-content-spaces.ts`](../../actions/list-content-spaces.ts)
- [`app/hooks/use-content-spaces.ts`](../../app/hooks/use-content-spaces.ts)

### 4. Add Files order modes without changing shared Files membership

Extend `ContentFilesSidebarView` to compute the effective sidebar order in this
sequence:

1. Apply the active view's filters.
2. Select the order source:
   - `Custom`: saved personal item IDs, then unsaved/new memberships by their
     base membership position.
   - `Last edited`: document `updatedAt` descending.
   - `Name`: locale-aware title ascending, with stable item-ID tie-break.
   - `Created`: document `createdAt` descending.
3. Apply hierarchy/group presentation while preserving the resulting sibling
   order.

Do not call `move-database-item` for an organization Files custom order: Files
membership positions are shared workspace data and may be viewer-only. Instead,
one `update-content-database-personal-view` call writes the full personal custom
item-ID sequence for that database view. This keeps two users independent and
allows a viewer to arrange references to pages they cannot edit.

Manual reorder is enabled only when `mode === "custom"`, no filters are active,
no grouping is active, and source/target share the same hierarchy parent.
Computed modes visibly suppress drag handles and disabled menu commands explain
that Custom is required. Switching modes is optimistic and preserves the
stored custom IDs.

Primary files:

- [`app/components/editor/database/sidebar.tsx`](../../app/components/editor/database/sidebar.tsx)
- [`app/components/editor/database/filter-sort.ts`](../../app/components/editor/database/filter-sort.ts)
- [`app/components/sidebar/DocumentSidebar.tsx`](../../app/components/sidebar/DocumentSidebar.tsx)
- [`app/hooks/use-content-database.ts`](../../app/hooks/use-content-database.ts)

### 5. Build one Content-local accessible reorder primitive

Create a small headless/app-local controller used by all three surfaces. It
owns pointer and keyboard sensors, same-list/same-parent validation, optimistic
`arrayMove`, live-region announcements, and semantic commands:

- `Move up`
- `Move down`
- `Move to…` (choose a position within the eligible sibling/list set)

Use shadcn `DropdownMenu` and existing `@dnd-kit` dependencies. Preserve native
link behavior: row titles are real links supporting Cmd/Ctrl-click,
middle-click, focus, and context menus; drag starts only from a dedicated
handle. The current Pinned overlay-button navigation should be replaced with
the modifier-safe `Link` pattern already used by the database sidebar row.

Keep the primitive under Content for now. If a second app adopts it, propose a
Toolkit headless controller whose host supplies IDs, capabilities, persistence,
and mutation callbacks.

Likely files:

- new `app/components/sidebar/use-sidebar-reorder.ts`
- new `app/components/sidebar/SidebarReorderMenu.tsx`
- [`app/components/sidebar/DocumentTreeItem.tsx`](../../app/components/sidebar/DocumentTreeItem.tsx)
- [`app/components/editor/database/sidebar.tsx`](../../app/components/editor/database/sidebar.tsx)

### 6. Complete agent parity, language, and product record

The existing `get-content-database`, `move-database-item`, and personal-view
actions provide the agent surface; document the exact membership identity and
personal/shared boundary in the Content instructions. `list-content-spaces`
must expose deterministic catalog order. Personal sidebar order mode is already
readable through `get-content-database-personal-view`; no expansion-state action
needs to become an agent tool.

Rename user-visible Favorites copy to the settled `Pinned` / `Pin to sidebar`
language in every locale while retaining internal system IDs for compatibility.
Add a user-visible changelog entry after the behavior is complete.

Primary files/surfaces:

- [`AGENTS.md`](../../AGENTS.md) or the narrow Content navigation skill selected during `/work`
- [`app/i18n`](../../app/i18n)
- focused action descriptions and generated action metadata
- `changelog/` through `agent-native changelog add`

## Verification plan

### Data and action tests

- One page belongs to Files, Pinned, and another database. Moving its exact
  Pinned item changes only Pinned positions.
- Membership positions remain gapless after first, middle, and last moves.
- Concurrent moves serialize through the database position lock.
- Unauthorized database/item pairs fail closed; a personally owned Pinned
  membership around a read-only page remains movable.
- Workspace catalog action order is deterministic and new workspaces append.
- Personal-view v2 data normalizes to the new version; invalid, duplicate,
  deleted, and inaccessible custom IDs cannot escape normalization.
- User A's Files custom order and mode do not alter User B's personal override
  or the shared Files membership positions.

### Component and interaction tests

- Pointer drag, keyboard drag, `Move up`, `Move down`, and `Move to…` produce
  the same final order on Pinned, Workspaces, and eligible Files siblings.
- Optimistic success does not jump after the response; failure restores the
  snapshot, announces the error, and refetches canonical state.
- Computed modes sort stably, disable manual controls, and preserve Custom.
- New items append; stale IDs disappear without hiding valid items.
- Filters/grouping and cross-parent Files drops disable or reject reorder.
- Links retain normal pointer, keyboard, modifier, middle-click, and context-menu
  behavior in LTR and RTL.
- All user-visible copy resolves in every supported locale.

### Real-interface acceptance

Run on a production-like preview with two authenticated users and two tabs:

1. Reorder Pinned by pointer, keyboard, and menu; reload and observe persistence.
2. Reorder workspace roots; confirm the other user keeps their order.
3. In an organization Files section, set a personal Custom order as each user;
   confirm independence and unchanged shared Files membership positions.
4. Switch through Name, Last edited, and Created; return to Custom and recover
   the prior sequence.
5. Attempt cross-parent drag, filtered/grouped reorder, and reorder in a
   computed mode; observe a clear non-destructive boundary.
6. Open rows normally, in a new tab, and with keyboard. Confirm no accidental
   drag or navigation regression.
7. Force a mutation failure and confirm rollback plus a visible error.

Fresh focused tests and real-interface proof are required during `/work`; the
prior shape could not run Vitest because this worktree did not have dependencies
installed at that time.

## Delivery sequence

1. Land the API normalization and locked action hardening with database tests.
2. Land the Content-local reorder controller and Pinned/Workspace integration.
3. Land Files personal order modes and schema-version compatibility.
4. Complete accessibility, RTL/i18n, instructions, and changelog coverage.
5. Run focused tests, typecheck/format checks, and the two-user real-interface
   acceptance story before declaring the work complete.

These are reviewable commits within one work unit, not independently shippable
half-features. Do not expose drag handles until the corresponding persistence,
rollback, and non-drag controls are present.

## Non-goals

- Drag-to-reparent or drag-to-move between workspaces.
- A shared organization Files custom order.
- Changing page parentage, ownership, access, or canonical database membership.
- General saved sidebar filters/grouping UI beyond respecting existing active
  filters/groups.
- A new Toolkit package or ejection seam.
- Renaming internal Favorites database identifiers.

## Approved work-ready fingerprint

### Material delta from shape-v1

```yaml
old-outcome: Personal custom order for Pinned references only.
proposed-outcome: Personal custom order for Pinned, workspace roots, and each workspace Files sidebar, plus computed Files order modes.
new-durable-surface:
  - personal Workspaces catalog membership positions
  - per-user per-database-view Files sidebar order mode and ordered item IDs
new-acceptance-boundary:
  - two-user independence for workspace and Files order
  - computed-mode preservation
  - same-parent-only hierarchical Files reorder
```

```yaml
stage: work
authority-source: Alice's July 26 explicit invocation of /work after reviewing shape-v2-proposed
authorized-scope:
  repositories:
    - builderio/agent-native
  product-surfaces:
    - Content Pinned section
    - Content workspace-root navigation
    - Content workspace Files sidebar view
  outcome: Let each signed-in user personally arrange sidebar references and choose useful Files order modes without moving or reparenting underlying pages.
allowed-mutations:
  - artifact-write
  - branch
  - commit
  - push
  - pull-request
write-targets:
  artifacts:
    - templates/content/docs/solutions/content-sidebar-order-shape.md
  production-source:
    - templates/content/actions
    - templates/content/app
    - templates/content/shared
    - templates/content/.agents/skills
    - templates/content/changelog
execution-lane:
  checkout: isolated-git-worktree
  branch: codex/content-sidebar-personal-order
  refreshed-base: fbb2436d10cb9a285a227f5634a485a64161a41f
  remote-default-branch: origin/main
governing-artifact:
  path: templates/content/docs/solutions/content-sidebar-order-shape.md
  revision: shape-v2-approved-work-v1
architecture-fingerprint:
  outcome: Personal custom ordering across Pinned, workspace roots, and Files sidebar views, with computed Files modes.
  shipping-surfaces:
    - id: content-pinned-custom-order
      repository: builderio/agent-native
      product-surface: templates/content sidebar Pinned section
      constituency: signed-in Content users
      durable-destination: user-scoped Pinned database membership positions
      integration-action: merge
    - id: content-workspace-custom-order
      repository: builderio/agent-native
      product-surface: templates/content workspace-root navigation
      constituency: signed-in Content users
      durable-destination: user-scoped Workspaces catalog membership positions
      integration-action: merge
    - id: content-files-sidebar-order
      repository: builderio/agent-native
      product-surface: templates/content workspace Files sidebar view
      constituency: signed-in Content users with workspace view access
      durable-destination: per-user content database personal-view settings
      integration-action: merge
  governing-architecture: Sidebar ordering mutates personal reference or view state, never document parentage, access, ownership, or shared Files membership.
  acceptance-story:
    id: content-sidebar-personal-order-v2
    summary: Two signed-in users independently arrange Pinned, workspace roots, and workspace Files references; computed Files modes remain reversible; no underlying content or shared membership moves.
    required-assertions:
      - Pointer, keyboard, and menu controls produce the same persisted order.
      - Pinned and workspace-root moves use exact personal membership identity.
      - Files Custom order and mode are personal per database view.
      - Name, Last edited, and Created disable manual reorder and preserve Custom.
      - Files manual reorder is same-parent only and unavailable with active filters or grouping.
      - Reload and a second tab converge on the persisted order.
      - Two authenticated users retain independent orders.
      - New references append and stale or unauthorized IDs fail safely.
      - Reorder never changes document parentId, position, workspace, visibility, sharing, ownership, or shared Files membership.
      - Read-only underlying pages can be personally arranged when the viewer owns the ordering surface.
      - Failed mutations roll back, report a visible error, and refetch canonical state.
      - Row links preserve native pointer, modifier, middle-click, context-menu, keyboard, and accessibility behavior.
      - User-facing strings use Pinned and Pin to sidebar with all-locale coverage.
  risk-strategy:
    kind: system-ready
    production-validation-after-merge: false
acceptance-state:
  status: passed-with-bounded-gap
  summary: Implementation, authoritative local verification, and independent real-interface H1-H6 acceptance are complete; forced-failure rollback was not safely exercised through the UI.
  blockers: []
work-evidence:
  implementation:
    - exact locked Pinned and workspace membership moves
    - per-user per-view Files order with membership ID pruning
    - sibling-local pointer, keyboard, and menu controls with label-aware announcements
    - optimistic rollback and canonical refetch paths
    - Pinned terminology, instructions, and changelog updates
  verified:
    - oxfmt check passed on all modified source files
    - git diff --check passed
    - 97 focused action, database, sidebar controller, presentation, native-link, and hook tests passed from the frozen lockfile install
    - 141 Content database tests passed
    - Content typecheck passed
    - i18n catalog guard passed across 18 catalog directories
    - Content production build passed; repository-wide doctor and externalized native-dependency warnings remain non-fatal
    - independent review cleared the repaired sibling-locality and access-aware stale-ID pruning blockers
    - independent browser QA passed Pinned pointer, keyboard, overflow-menu, reload, native-link, and second-tab behavior
    - independent browser QA passed workspace-root overflow-menu reorder and reload persistence
    - independent browser QA passed Files Custom persistence, all computed modes, disabled computed-mode drag controls, and Custom restoration
    - independent browser QA proved two-user independence on one shared organization Files surface: the same unique row persisted first for account A and last for account B across reload and re-login
  pending:
    - safe user-visible forced-failure rollback, if the local interface exposes a non-destructive failure mechanism
    - monorepo-wide fast-suite confirmation in its supported CI runtime; the local Node 26 run was stopped after 207 environment-caused failures among 9,393 passes and one skip
ledger-revision: content-sidebar-order-work-v1
status: active
product-boundary-gates:
  agent-native-public-constituency: Any source-blind developer installing the public Content template can use personal sidebar ordering without Alice's vault, machines, credentials, or private orchestration.
```

## Uncertainties and conscious tradeoffs

- The linked Slack recording remains uninspected, so this plan answers the
  agreed product direction rather than claiming exact reproduction of Matt's
  gesture.
- An ordered-ID array in a personal setting is intentionally the smallest
  compatible Files-view seam. It matches the current client-loaded sidebar
  dataset; if workspaces become too large for that model, pagination and a
  normalized personal-rank table should be shaped together rather than
  prematurely introduced here.
- Files grouping is respected for display but excludes manual reorder in this
  slice. Reordering within multiple groups can be designed later with an
  explicit per-group contract.
- `Move to…` in the reorder menu means “move to a position in this eligible
  list,” not “move the document to another parent/workspace.” Copy and menu
  grouping must keep those commands unmistakably separate.

## Natural next stage

After every frozen assertion has current evidence and the exact artifact is
merge-ready: `/land docs/solutions/content-sidebar-order-shape.md`
