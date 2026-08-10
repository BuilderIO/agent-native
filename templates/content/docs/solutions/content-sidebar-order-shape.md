# Content sidebar personal ordering

> SHAPE V3 APPROVED FOR WORK
>
> Alice supplied a concrete feedback recording and explicitly requested that the
> revised plan be shaped, implemented, and returned on PR #2423's existing
> preview. This revision supersedes the earlier handle-and-menu interaction
> plan while retaining its personal-order persistence boundary.
>
> Alice's July 28 follow-up clip clarifies the same approved interaction story;
> it does not add a shipping surface or change the persistence boundary. The
> clarifications below are tracked as v3.1 implementation and acceptance
> evidence under the existing fingerprint.

## Refresher

Content now supports personal custom order for Pinned references, workspace
roots, and each workspace's Files list. The first implementation proved the
data boundary but exposed too much implementation chrome: visible grip handles,
full-width `Order: Custom` rows, and overflow commands for moving an item.
Pointer dragging could also escape horizontally and create an oversized scroll
region, and its landing position was not explicit enough.

Alice's July 27 feedback establishes the revised interaction:

- The primary surface of a reorderable sidebar row is the drag target. There is
  no dedicated visible grip.
- Drag motion is vertical and bounded to valid visible slots in its current
  list. A clear horizontal insertion bar shows the landing slot.
- Interactive children such as expand, add, overflow, and sort controls remain
  ordinary controls and never initiate a drag.
- Keyboard dragging remains available from the focusable primary row; the new
  `Move up`, `Move down`, and `Move to position` overflow commands are removed.
- In an expanded workspace, a compact sort icon next to its add button replaces
  the separate `Order: Custom` row and opens `Custom`, `Last edited`, `Name`,
  and `Created`; collapsed workspaces stay data-lazy.
- Workspace folder icons and labels share one visual baseline.
- The editor block preview stays aligned to the point where the user grabbed
  the block instead of floating below the pointer.

All sidebar dragging changes only the current viewer's order. It never reparents
a document, moves it between workspaces, changes access or ownership, or
rewrites shared Files membership.

## July 28 feedback clarification (v3.1)

The second preview review showed four defects inside the frozen v3 story:

- Releasing a pointer drag on a sidebar row can still activate its link. The
  release must commit the reorder without navigating; a later ordinary click
  must continue to navigate normally.
- The primary row advertises a grab cursor before a drag exists. It should use
  the app's ordinary pointer cursor at rest and switch to dragging feedback only
  after the activation threshold is crossed.
- Long row and workspace labels reserve action-button space even while those
  actions are hidden. At rest, text may use the full available row width and
  ellipsize at the actual boundary; hover or focus reveals actions and contracts
  the label immediately, without animation.
- Nested Files rows inherit a narrower right edge from their indentation
  wrapper. Nesting changes only the left edge; overflow and add controls remain
  aligned to the sidebar's shared right rail at every depth.

The clip also exposes a regression in the already-approved Toolkit assertion:
after a successful editor block drop, the moved block retains a visible text or
node selection and editor focus. Completing the drop must collapse incidental
selection and blur the editor while preserving the moved block and every
existing before/after, column, and cross-editor drop contract.

These points clarify assertions 2, 6, 9, 10, and 13 below. They restore the
intended click-versus-drag and editor-drop behavior; they do not change the
outcome, shipping surfaces, governing architecture, risk strategy, or durable
order model.

## Interaction contract

```text
NORMAL                              DRAGGING
┌────────────────────────────┐      ┌────────────────────────────┐
│ PINNED                     │      │ PINNED                     │
│   Launch brief             │      │   Launch brief             │
│   Roadmap                  │  →   │ ━ landing slot ━━━━━━━━━━ │
│   Research notes           │      │   Roadmap                  │
└────────────────────────────┘      │   Research notes           │
                                    └────────────────────────────┘

Primary row: click opens; drag reorders; Space picks up for keyboard reorder
Row controls: expand/add/sort/overflow keep their ordinary click behavior
Movement: vertical, clamped to the current visible list, same-parent where needed

WORKSPACE HEADER
┌───────────────────────────────────┐
│ ▾  Personal                 ⇅  + │
└───────────────────────────────────┘
                              │
                              └─ Custom / Last edited / Name / Created
```

The insertion bar uses normal foreground contrast. It is a slot marker, not a
document hierarchy affordance. Files drops across parent boundaries remain
invalid; nesting still uses the explicit document-move capability.

## Desired outcome

Each signed-in Content user can quietly arrange Pinned references, workspace
roots, and eligible Files siblings through a familiar row-drag interaction,
choose useful computed Files orders from the workspace header, and trust that
the operation affects only their personal navigation view.

## Product decisions

| Surface         | Durable order                                    | Pointer interaction                                | Keyboard interaction                   | Order modes                        |
| --------------- | ------------------------------------------------ | -------------------------------------------------- | -------------------------------------- | ---------------------------------- |
| Pinned          | Personal Pinned membership positions             | Drag primary row                                   | Focus row, Space/arrow reorder         | Custom                             |
| Workspace roots | Personal Workspaces catalog membership positions | Drag primary row                                   | Focus row, Space/arrow reorder         | Custom                             |
| Workspace Files | Per-user database-view ordered membership IDs    | Drag primary row in eligible Custom view           | Focus row, Space/arrow reorder         | Custom, Last edited, Name, Created |
| Editor blocks   | Existing document structure                      | Existing block grip; preview preserves grab offset | Existing block-menu behavior unchanged | Not applicable                     |

Computed Files modes retain the saved Custom sequence. Manual Files reorder is
available only in `Custom` with no active grouping/filter ambiguity and only
within the visible sibling set. New references append; inaccessible or stale
IDs are ignored and pruned by the existing normalization path.

## Architecture grounding and fit

Architecture grounding is required because one feedback item touches the
shared editor Toolkit.

### Demonstrated callers

- Content sidebar user dragging Pinned, workspace, and Files rows in the PR
  #2423 preview.
- Content `VisualEditor` user dragging a text block and observing its clone
  below the pointer in the July 27 feedback recording.

### Existing primitives and ownership boundaries

- `templates/content/app/components/sidebar/sidebar-reorder.tsx` owns the
  Content-local sortable controller, personal-order semantics, keyboard sensor,
  and announcements.
- `templates/content/app/components/editor/database/sidebar.tsx` owns Files
  presentation and order-mode selection.
- `templates/content/app/components/sidebar/DocumentSidebar.tsx` owns workspace
  headers and the Pinned/workspace integration.
- `packages/toolkit/src/editor/DragHandle.ts` owns the shared floating block
  preview and drop geometry used by Content and Plan. Host apps own its CSS.

### Legacy contracts that remain unchanged

- Exact Pinned/workspace membership persistence and per-user Files settings.
- Same-parent Files validation, optimistic rollback, and canonical refetch.
- Native link activation, modified click, middle click, context menu, focus, and
  nested action controls.
- Toolkit block selection, action menu, before/after reorder, side-column drops,
  cross-editor transfer, drop indicators, and wrapper configuration.

### Smallest compatible delta

Keep sidebar sorting Content-local. Replace handle-only listeners with primary
row listeners, expose one slot indicator from the existing sortable context,
and bound pointer transforms to the list's vertical geometry without changing
the persistence actions. In Toolkit, record the pointer-to-source-block offset
when a drag begins and reuse that offset for the floating preview transform.

### Deferred capabilities

- Shared Toolkit sidebar-sortable controller.
- Shared organization Files order.
- Drag-to-reparent or drag-to-move between workspaces.
- A permanently visible keyboard reorder menu.
- Rich auto-scroll for lists longer than the visible sidebar; this slice favors
  bounded visible slots over runaway off-screen motion.

### Evidence classification

Direct evidence:

- The July 27 clip demonstrates visible handles, horizontal escape, oversized
  scrolling, absent landing clarity, block-preview offset, workspace icon
  misalignment, the full-width order control, and move-command menu clutter.
- Current source shows the sidebar listeners attached only to
  `SidebarDragHandle` and the Toolkit preview positioned with hard-coded pointer
  offsets.

Inference:

- Preserving keyboard drag on the primary row satisfies the accessibility goal
  without retaining the menus Alice asked to remove. This must be proven in the
  real interface.

Unresolved owner questions: none.

## Implementation plan

### 1. Revise the Content-local reorder primitive

- Remove the exported visible drag-handle and move-command menu components.
- Expose sortable attributes/listeners as primary-row drag props.
- Track active and over IDs and expose a before/after slot indicator only for a
  valid same-parent target.
- Force pointer transforms onto the vertical axis, clamp them to the current
  reorder container, and suppress runaway auto-scroll.
- Preserve keyboard sensors, localized announcements, and optimistic reorder
  callbacks.

### 2. Apply row dragging across all three sidebar surfaces

- Put drag props on each row's primary link/surface, not on expand/add/sort or
  overflow controls.
- Render the slot indicator at the correct row boundary.
- Remove reorder commands from Pinned, workspace, and Files overflow menus while
  preserving pin, delete, add, and other non-reorder actions.
- Keep Files hierarchy and computed-mode guards intact.

### 3. Simplify workspace order controls and alignment

- Lift the Files order menu into the workspace header next to `+` as an icon-only
  shadcn dropdown with tooltip and mode-aware accessible name.
- Remove the separate full-width order row from `ContentFilesSidebarView`.
- Align folder/toggle icon and label within the same header flex geometry.

### 4. Align the shared block drag preview

- Extend the Toolkit drag session with the pointer's offset from the source
  block at mouse-down.
- Position the preview from that captured offset rather than fixed `+12/+10`
  values.
- Add focused Toolkit tests covering offset capture and transform behavior and a
  Toolkit changeset; keep every drop contract unchanged.

### 5. Verify and return to the same preview

- Update focused component/source tests, i18n expectations, Content docs, and
  the existing changelog entry if its wording becomes inaccurate.
- Run format, focused sidebar/Toolkit tests, Content typecheck, and the relevant
  Content build.
- Obtain independent technical review for the final material diff.
- Run independent real-interface QA against the exact new PR head and the
  existing dummy account/fixture.
- Commit and push the current task branch so Netlify updates
  `deploy-preview-2423--agent-native-content.netlify.app`; verify the exact head
  and interaction before returning the link.

## Acceptance story

Successful-user story `content-sidebar-personal-order-v3`:

A signed-in Content user drags a Pinned row, workspace root, or eligible Files
row from its primary surface; the item stays inside the visible vertical list,
a clear insertion bar marks the landing slot, and reload preserves only that
user's order. Workspace order mode is chosen from the compact header icon.
Underlying documents and shared memberships never move. An editor block preview
stays aligned with its grab point.

Required assertions:

1. No visible sidebar grip handles or reorder-only overflow commands remain.
2. Dragging starts from the primary row surface while nested controls remain
   independently clickable.
3. Pointer motion is vertical and bounded; horizontal escape and giant drag
   scroll regions do not occur.
4. A visible insertion bar identifies every valid landing slot, including first
   and last positions, and invalid cross-parent targets show no slot.
5. Keyboard dragging remains operable from the primary row with accurate
   localized announcements.
6. Pinned, workspace, and eligible Files orders persist across reload and a
   second tab without changing another user's order.
7. Computed Files modes disable manual reorder and returning to Custom restores
   the saved sequence.
8. For an expanded workspace, the order icon sits beside `+`, exposes the
   current mode accessibly, and opens all four order choices; the old full-width
   row is absent and collapsed workspaces do not fetch their Files view.
9. Folder/toggle icons and workspace labels share a consistent baseline.
10. Row links preserve ordinary, modified, middle-click, context-menu, and
    keyboard navigation behavior.
11. Reorder never changes document parentage, canonical position, workspace,
    access, visibility, sharing, ownership, or shared Files membership.
12. Failed persistence rolls back visibly and refetches canonical state.
13. Content and Plan block dragging retain existing drop behavior while the
    floating preview preserves the pointer's source-block offset; completing a
    successful drop leaves no incidental text/node selection or editor focus.

## Architecture fingerprint and authority envelope

```yaml
stage: work
authority-source: Alice's July 27 request to shape the new implementation plan, work it, and show the same preview
authorized-scope:
  repositories: [builderio/agent-native]
  product-surfaces:
    - Content Pinned section
    - Content workspace-root navigation
    - Content workspace Files sidebar view
    - shared Toolkit editor block drag preview used by Content and Plan
  outcome: Quiet, bounded row-drag personal sidebar ordering with compact workspace sort controls and pointer-aligned editor block previews.
allowed-mutations:
  - artifact-write
  - branch
  - commit
  - push
  - pull-request
  - deploy
  - ephemeral-test-resource
write-targets:
  artifacts:
    - templates/content/docs/solutions/content-sidebar-order-shape.md
  production-source:
    - templates/content/app
    - templates/content/app/i18n
    - templates/content/.agents/skills
    - templates/content/changelog
    - packages/toolkit/src/editor
    - packages/toolkit tests
    - .changeset
governing-artifact:
  path: templates/content/docs/solutions/content-sidebar-order-shape.md
  revision: shape-v3-feedback-approved
architecture-fingerprint:
  outcome: Bounded primary-row sidebar dragging, compact Files ordering, and aligned shared block preview geometry.
  shipping-surfaces:
    - id: content-pinned-custom-order
      repository: builderio/agent-native
      product-surface: Content sidebar Pinned section
      constituency: signed-in Content users
      durable-destination: user-scoped Pinned membership positions
      integration-action: merge
    - id: content-workspace-custom-order
      repository: builderio/agent-native
      product-surface: Content workspace-root navigation
      constituency: signed-in Content users
      durable-destination: user-scoped Workspaces catalog membership positions
      integration-action: merge
    - id: content-files-sidebar-order
      repository: builderio/agent-native
      product-surface: Content workspace Files sidebar view
      constituency: signed-in Content workspace viewers
      durable-destination: per-user database personal-view settings
      integration-action: merge
    - id: toolkit-editor-drag-preview-alignment
      repository: builderio/agent-native
      product-surface: shared Toolkit editor drag preview
      constituency: Content and Plan editor users
      durable-destination: packages/toolkit editor primitive
      integration-action: merge
  governing-architecture: Content owns personal sidebar ordering; Toolkit owns shared block-preview geometry; neither path changes document hierarchy or authorization.
  acceptance-story:
    id: content-sidebar-personal-order-v3
    summary: The successful-user story and thirteen required assertions above.
  risk-strategy:
    kind: system-ready
    production-validation-after-merge: false
architecture-grounding:
  applicability: required
  status: grounded
  smallest-compatible-delta: Content-only sidebar interaction revision plus one pointer-offset correction in the existing shared Toolkit primitive.
  unresolved-owner-questions: []
test-resources:
  - id: pr2423-sidebar-fixture
    kind: account
    surface: https://deploy-preview-2423--agent-native-content.netlify.app
    ownership-marker: sidebar-fixture-2423-20260727@example.com and pages 3Bhw76VZaFfk, be8GwXDPsSdj, UdCg05CsA0M6
    allowed-actions: [acquire, exercise, update]
    cleanup-trigger: after Alice completes preview validation or preview teardown
    cleanup-method: delete the dummy preview account and its task-created pages through the preview UI/action surface
    cleanup-proof: authenticated absence check for the exact email and page IDs
    shared-impact: none
    isolation: branch-preview
    ownership: task-exclusive
    production-data: false
    customer-data: false
    cost: none
    status: active
    phase: work
ledger-revision: content-sidebar-order-work-v3
status: active
```

## Non-goals

- Reparenting documents or moving them between workspaces.
- Shared organization ordering.
- New persistence actions or schema changes.
- A general Toolkit sidebar navigation API.
- Merge or production enablement; this Work unit ends at the updated PR preview.

## Natural next stage

After the exact PR head passes technical and independent real-interface evidence,
return the same preview for Alice's validation. Merge remains a separate `/land`
decision.
