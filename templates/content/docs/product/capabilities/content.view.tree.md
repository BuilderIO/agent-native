---
record_type: "capability"
spec_version: 2
id: "content.view.tree"
name: "Tree View"
user_promise: "Tree renders any suitable hierarchical Relationship without creating a parallel parent system."
primary_user_job: "Navigate and change an authorized hierarchy while knowing that its structure is a typed relationship, not an accidental page parent."
kind: "surface"
state: "approved_shape"
publicness: "public"
availability: "universal"
dependencies: ["content.relationship.edge", "content.view.renderer-conformance"]
related_features: []
roadmap_boundary: "supporting"
acceptance_summary: "Tree renders a chosen hierarchical Relationship over canonical access-scoped results, supports authorized relationship edits, and preserves typed edge truth across expansion and arrangement."
proof_requirements:
  [
    "Hierarchical relationship selection, roots, cycles, multi-parent or orphan policy, expansion, and configuration coverage",
    "Shared typed Relationship Action, access-safe disclosure, history, and recovery coverage",
    "Real-interface keyboard tree semantics, assistive technology, lazy loading, reload, and dense hierarchy workflow",
  ]
evidence: []
superseded_by: null
last_reviewed: "2026-07-29"
---

# Tree View

## Why this exists

Some relationships are best read as nesting. Tree makes that shape useful without
smuggling a universal parent field into Pages.

## Example workflow

A manager selects the `contains` relationship for a project View, expands a branch,
and moves a task through the shared Relationship Action. The same edge remains visible
in Connections and other authorized projections.

## Product contract

- Tree selects a suitable typed hierarchical Relationship and renders canonical nodes and edges.
- Expansion, collapse, order, and focused state are View presentation; they do not redefine hierarchy.
- Relationship creation, removal, and move use the shared typed Action with its constraints and history.
- Access applies before roots, branch counts, labels, traversal, export, or agent context.

## Boundaries and non-goals

Relationships own semantic truth and cardinality. Tree is not Page-parent ownership,
a sidebar model, a file system, or a separate hierarchy datastore.

## Acceptance stories

### Expand an authorized branch

Given a hierarchy with inaccessible descendants, when a viewer expands a node, then no
child label, count, or placeholder leaks inaccessible relationships.

### Change a typed edge

Given an editor allowed to alter a hierarchical edge, when they move a node, then the
shared Relationship Action applies its cycle and cardinality rules and records history.

## Current evidence

The shared relationship boundary is prerequisite substrate; no complete Tree renderer
contract is proven in the repository. This Capability remains `approved_shape`.

## Proof plan

1. Test roots, cycles, multiple parents, orphans, expansion, configuration, and lazy loading.
2. Verify Action parity, access closure, history, concurrent changes, and recovery.
3. Exercise ARIA tree navigation, keyboard moves, screen readers, reload, and dense branches.

## Open questions

The default policy for a relationship type that permits multiple parents needs design.
