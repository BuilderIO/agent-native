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
    "../../../app/components/editor/database/sidebar.tsx",
  ]
superseded_by: null
last_reviewed: "2026-07-29"
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
- Personal ordering, expansion, and collapse do not reparent Pages, change Database membership, or grant shared edit authority.
- Intentional references may expand; the sidebar is not a general-purpose object renderer.
- Missing, deleted, inaccessible, stale, and unavailable entries are handled honestly and recoverably.

## Boundaries and non-goals

References and Queries own target and result meaning. This does not define Page hierarchy,
general Tree View, or a hidden shared workspace organizer.

## Acceptance stories

### Reorder a personal pin

Given two pinned References, when a viewer changes their order, then only that person's
navigation preference changes and neither target Page's parentage nor membership changes.

### Open an access-scoped section

Given a dynamic section with inaccessible items, when a viewer expands it, then its rows,
counts, and previews disclose only authorized results.

## Current evidence

Existing sidebar section tests and sidebar rendering show useful donor behavior. They do
not prove the full Reference/query, access, recovery, and personal-state contract; this
Capability remains `approved_shape`.

## Proof plan

1. Test pin, reorder, expand, query sections, reload, and stale-reference recovery.
2. Verify access closure and that personal operations cannot mutate shared structure.
3. Exercise keyboard, ARIA navigation, responsive behavior, agent context, and unavailable sources.

## Open questions

The first dynamic-section catalog and section-level personalization controls need design.
