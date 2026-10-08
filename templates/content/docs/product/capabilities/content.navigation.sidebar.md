---
record_type: "capability"
spec_version: 2
id: "content.navigation.sidebar"
name: "Personal sidebar"
user_promise: "The sidebar is a personal navigation surface with pinned references and query-backed dynamic sections, not object hierarchy."
primary_user_job: "Return to my important work and discover authorized dynamic collections without changing shared object structure."
kind: "surface"
state: "approved_shape"
publicness: "public"
availability: "universal"
dependencies: ["content.object.reference", "content.query.object"]
related_features:
  [
    "content.feature.find-your-place-again",
    "content.feature.make-the-workspace-yours",
  ]
roadmap_boundary: "feature"
acceptance_summary: "A personal sidebar stores pinned References and dynamic query sections, supports intentional expansion and order, and never treats navigation placement as object parentage or shared mutation."
proof_requirements:
  [
    "Personal pin, order, expand, collapse, query-section, and reload coverage",
    "Access-safe section results, counts, previews, stale references, and dynamic recovery coverage",
    "Keyboard, screen-reader, responsive, agent-context, and shared-mutation-denial workflows",
  ]
evidence:
  [
    "../../../app/components/sidebar/document-sidebar-sections.test.ts",
    "../../../app/components/sidebar/DocumentSidebar.layout.test.ts",
    "../../../actions/move-page-to-space.db.test.ts",
    "../../../app/components/editor/database/sidebar.tsx",
    "../../../actions/content-recent.test.ts",
    "../../../actions/content-personal-navigation-patch.test.ts",
    "../../../app/components/editor/database/DatabaseView.recent.test.ts",
    "../../../app/hooks/use-content-database.test.ts",
  ]
superseded_by: null
last_reviewed: "2026-09-23"
---

# Personal sidebar

## Why this exists

Navigation should remember what matters to a person without quietly rewriting the
workspace's structure. The sidebar is a map, not the territory; maps are allowed taste.

## Example workflow

A viewer pins a Page, reorders their personal references, expands an intentional
reference, and opens a dynamic query section. Another viewer's order and the Page's
parentage remain unchanged.

## Product contract

- Pinned entries are personal References; dynamic sections are access-scoped query results.
- Personal ordering, expansion, and collapse do not reparent Pages, change Collection membership, or grant shared edit authority.
- Intentional references may expand; the sidebar is not a general-purpose object renderer.
- Every sidebar row opens one Page menu with one order: pin; copy link and open in a new tab; rename, duplicate, and move; remove from Recent or move to Trash; then who last edited the Page and when. Each section offers only the items it allows, and each item still requires the caller's access.
- Files and Pinned rows may rename, duplicate a Page with its sub-pages beside the original, move it within its Content space or into another space the viewer can add pages to, and move it to Trash. Local-file Pages mirror disk and are not renamed, duplicated, or moved from the sidebar, and local-folder spaces are never offered as destinations.
- Moving a Page to another space moves its sub-pages with it. The person moving becomes the owner, and access resets to the destination's: organization-wide in an organization space, private otherwise, or the new parent's sharing. Existing shares and public access are removed, and the viewer is warned and confirms before anything moves. Comments, history, and block identities travel with the Pages. Pages that contain Collections, Collection rows, local-folder files, and Notion- or Builder-linked Pages cannot change space yet and are refused with a reason.
- Recent rows carry only actions that leave the Page unchanged: pin or unpin, copy link, open in a new tab, and remove from Recent. Shared mutations such as rename, move, trash, add child, and reorder stay with Files and Pinned.
- Missing, deleted, inaccessible, stale, and unavailable entries are handled honestly and recoverably.

## Boundaries and non-goals

References and Queries own target and result meaning. This does not define Page hierarchy,
general Tree View, or a hidden shared workspace organizer.

## Acceptance stories

### Reorder a personal pin

Given two pinned References, when a viewer changes their order, then only that person's
navigation preference changes and neither target Page's parentage nor membership changes.

### Forget a Recent destination

Given a Page in a viewer's Recent, when they remove it from Recent, then only that
viewer's Recent history changes; the Page, its pins, and every other viewer's Recent
are unchanged.

### Move a Page into an organization space

Given a private Page with a sub-page and an existing share, when its owner moves it to
an organization space and confirms the warning, then both Pages appear in that space's
Files, everyone in the organization can view them, the old share no longer applies, and
their comments and history are still there.

### Open an access-scoped section

Given a dynamic section with inaccessible items, when a viewer expands it, then its rows,
counts, and previews disclose only authorized results.

## Current evidence

Existing sidebar section tests and sidebar rendering show useful donor behavior. They do
not prove the full Reference/query, access, recovery, and personal-state contract; this
Capability remains `approved_shape`.

Personal section settings and bounded Recent navigation use per-user Actions. Recent
stores one entry per Database with its latest successfully visited View, resolves
current labels under current access, and records successful foreground visits rather
than reads or edits. New pins prepend in personal custom order without changing shared
parentage or membership. The persistent Search launcher opens the existing command
menu instead of maintaining a second sidebar search implementation.

The sidebar now selects one existing Content space without changing organization
context. Pinned and Recent are filtered at the Action boundary by authoritative current
Files membership before display limits, while aggregate Favorites remains reachable for
legacy and unassigned pins. The selected space's Files tree is the only tree rendered;
section order, visibility, and expansion persist, while five-row Pinned and Recent
display counts are deliberately transient. Contextual pin reorder patches only the
loaded subset and preserves unrelated personal order entries. Files, Pinned, and Recent
share a presentational navigation row and one hover/focus row-actions layer; Recent
retains its real icon and exact View link without inheriting tree expansion or shared
mutation controls. Its row menu offers Pin/Unpin, using the requester's pinned state
resolved under the same access as the row, and Remove from Recent through the shared
`remove-content-recent` Action, which forgets only that user's visit.

Files and Pinned rows use the same menu with Rename (inline, through `update-document`),
Duplicate (`duplicate-database-item`, which now keeps the copy under the original's
parent and, when named by Page id, uses the Page's own space Files membership rather
than a Favorites membership), Move to (a same-space picker over `move-document`), and
Move to Trash. The menu footer reads `get-document-activity` only while open.
Duplicate now uses `duplicate-page`, which copies the Page's sub-pages too (Collections
stay put) and places each copy as if the caller created it there. Move to picks a space
first and warns before a cross-space move; `move-document` with `spaceId` then rewrites
the subtree's space, owner, and visibility, drops its shares, swaps Files membership,
and carries comments, history, and block identities in one transaction. Database tests
cover moving with comments and history, ownership handoff, nesting only under the
mover's own Pages, refusing Pages with Collections, and duplicating within and across
spaces.
Reorderable rows now stay inside the sidebar width, so Pinned row actions are visible.

Each section's menu opens its complete selected-space collection: scoped personal pins,
the retained Recent window, or the canonical Files table. Section headers use one grid
for the toggle/drag surface and menu; pointer dragging works from the icon, label, or
empty header space while the menu remains separate. Tree paging rows share the file-row
grid so nested Show more controls align with their child depth.

Database-backed workspace trees read at most 20 roots or immediate children per page,
use cursor-based Show more, and resolve an active path without enumerating every
document. Focused tests cover paging limits, parent-scoped reads, access filtering,
cursor scope and staleness, active-path context, bounded deletion outcomes, bounded
recency, legacy Recent migration, personal pin ordering, and navigation patch
concurrency. These are useful implementation and test evidence, not complete atomic
contract proof. Local authenticated UI evidence and mounted lifecycle recovery remain
incomplete, so this Capability remains `approved_shape`.

The September 9, 2026 SB-01–03 controls pass exercised collapsed and expanded
Search, Escape focus return, accessible control names, keyboard and pointer
resizing within 240–480px, width persistence after reload, and a 390px mobile
drawer through the local interface. The command picker uses the shared dialog
stack so it remains visible above the drawer. This bounded controls evidence
does not establish the remaining personal-reference, dynamic-section, access,
or recovery contracts.

## Proof plan

1. Test pin, reorder, expand, query sections, reload, and stale-reference recovery.
2. Verify access closure and that personal operations cannot mutate shared structure.
3. Exercise keyboard, ARIA navigation, responsive behavior, agent context, and unavailable sources.

## Open questions

- Pages that contain Collections, and Collection rows, cannot change space yet. Carrying
  a Collection's rows, properties, views, and sources to another space, and whether a
  duplicate should copy a Collection rather than keep pointing at it, is undecided.

- The initial catalog is Pinned and Recent alongside selected-space Files navigation.
  Pinned and Recent start visible and expanded, show five entries initially, and allow
  five-entry increments up to fifty. Section order, visibility, and expansion are
  personal preferences; display limits reset after refresh, collapse/reopen, or a
  Content-space switch.
- Database Recent identity is one entry per Database, retaining its latest visited View;
  plain Pages remain separate destinations. Explicit exact-View links and existing
  exact-View pins are not changed by this behavior.
- Database-backed workspace navigation is bounded to 20 roots or children per page.
  Local-file mode still builds its sidebar from an unbounded document inventory and is
  the explicit residual before the full bounded-navigation promise can be proven.
- Additional dynamic sections remain outside this slice.
