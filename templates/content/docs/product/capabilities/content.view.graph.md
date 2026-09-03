---
record_type: "capability"
spec_version: 2
id: "content.view.graph"
name: "Graph View"
user_promise: "Graph lays out query-selected canonical objects and typed Relationships for access-safe exploration and editing."
primary_user_job: "Explore a meaningful neighborhood of connected records, understand why they relate, and make an authorized semantic change without treating a visual line as the source of truth."
kind: "surface"
state: "approved_shape"
publicness: "public"
availability: "universal"
dependencies:
  [
    "content.knowledge.graph",
    "content.relationship.edge",
    "content.view.renderer-conformance",
  ]
related_features: ["content.feature.sketch-connections-keep-whats-true"]
roadmap_boundary: "feature"
acceptance_summary: "Graph renders an access-scoped saved relationship query as canonical nodes and typed edges, supports authorized typed-edge editing, and keeps every layout operation separate from semantic truth."
proof_requirements:
  [
    "Access-scoped graph-query results, traversal, expansion, filtering, and empty or unavailable states",
    "Typed-edge creation, editing, removal, permission denial, and history through the shared Relationship Action",
    "Manual and physics-assisted layouts, pinning, saved arrangements, reset, and proof that layout never mutates semantic relationships",
    "Keyboard, assistive-technology, dense-neighborhood, and drill-in workflows in the real interface",
  ]
evidence: []
superseded_by: null
last_reviewed: "2026-07-29"
---

# Graph View

## Why this exists

A list can show that records are related without making the surrounding structure legible. Graph View lets people explore an access-scoped semantic neighborhood: canonical records are nodes, and each visible line is a real typed Relationship rather than decoration.

It is for questions such as “what supports this claim?” or “which work is blocked by this decision?” It is not a drawing board, a statistical chart, or an authored diagram.

## Example workflow

A project lead opens a saved graph query centered on a decision Page and expands one relationship type at a time. They pin the Pages relevant to a review, use a force-assisted layout to separate a crowded neighborhood, and save that arrangement for later. With the `blocks` type selected in the edge tool, they draw from one authorized Page to another; Content creates the corresponding canonical Relationship and shows it in Connections and other authorized projections. Resetting the layout changes only positions, never the relationship.

## Product contract

- Graph renders a saved, typed, access-scoped relationship query. Nodes retain their canonical Page, Block, Source, or query-result identity; Graph owns only its View configuration and arrangement.
- Each semantic edge displays a Relationship type and is a projection of the canonical edge. Editing, removing, or creating an edge uses the shared typed Relationship Action and records normal history.
- The edge tool requires a Relationship type before it can create an edge. A line never becomes a semantic assertion merely because it was drawn.
- People may filter, group, and style by relationship type; expand authorized neighbors; open canonical records; pin or unpin nodes; save a useful arrangement; and reset it.
- Manual, hierarchical, radial, and physics-assisted layouts may change positions only. Layout algorithms never infer, create, rewrite, or delete Relationships.
- Graph applies access before query evaluation, traversal, counts, labels, previews, export, or agent use. An inaccessible endpoint is not exposed through a visible placeholder, degree, or hidden-edge count.
- An empty query is an honest empty Graph. A failed, stale, or unavailable query reports that state distinctly and does not masquerade as no relationships.

## Boundaries and non-goals

- `content.relationship.edge` owns canonical edge identity, cardinality, authority, mutation, and history; Graph is an authorized editor and projection.
- `content.knowledge.graph` owns relationship-query semantics and traversal; Graph owns visual exploration and layout.
- `content.view.canvas` owns intentional spatial composition and view-local freeform connectors. Canvas lines require explicit promotion before they become Relationships.
- `content.view.chart` owns analytical visualizations over measures and grouped data. Authored Mermaid diagrams belong to code-authoring and Mermaid rendering, not Graph.
- Graph does not create a parallel graph datastore, access model, permission bypass, task dependency engine, or diagram language.

## Acceptance stories

### Explore only what the viewer may know

Given a saved graph query that includes both accessible and inaccessible relationships, when a viewer opens and expands Graph, then the graph, counts, labels, previews, and exports contain only authorized nodes and edges, while a direct unauthorized request receives an honest denial.

### Create a semantic edge deliberately

Given an editor authorized to change two Pages and use the `supports` Relationship type, when they select `supports` and draw an edge, then one canonical typed Relationship is created and appears in Connections and other authorized projections. When no type is selected, drawing cannot commit an edge.

### Separate arrangement from meaning

Given a dense saved Graph, when a viewer pins nodes, runs a force-assisted layout, saves the arrangement, and later resets it, then node positions change as requested but the relationship query and canonical edge history remain unchanged.

### Report unavailable work truthfully

Given a graph query that cannot complete because its source is unavailable, when Graph opens, then it reports the unavailable state and retry path rather than rendering a plausible empty neighborhood.

## Current evidence

The repository defines the shared object, query, Relationship, and renderer boundaries that Graph will need. Existing code may offer useful visualization or relation substrate, but no current evidence proves the complete Graph query, edge-editing, access-closure, layout, or recovery contract. This Capability remains `approved_shape`.

## Proof plan

1. Exercise saved graph queries with filtering, expansion, grouping, pagination or bounds, empty results, stale inputs, and unavailable sources.
2. Create, edit, and remove typed edges through Graph alongside Connections and another projection; verify one identity, permission decision, and committed history.
3. Verify manual, hierarchical, radial, and physics-assisted layouts across pin, save, reload, reset, and concurrent semantic edits; assert that no layout path changes an edge.
4. Run keyboard and assistive-technology workflows for navigation, node inspection, edge-type selection, editing, errors, and dense-graph recovery.
5. Re-run traversal, labels, counts, previews, export, and agent reads with changing endpoint access to prove access precedes every computation.

## Open questions

The contract leaves rendering-engine choice, layout implementation, graph-size limits, and exact controls open. Those choices must preserve bounded loading, explicit failure states, and the semantic/layout separation above.
