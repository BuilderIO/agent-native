---
record_type: "capability"
spec_version: 2
id: "content.renderer.graph"
name: "Collection graph renderers (superseded)"
user_promise: "Historical umbrella for graph and chart rendering, now split into distinct semantic Graph and analytical Chart capabilities"
primary_user_job: "Follow the lineage from the former combined renderer concept to the precise modern capability that owns the work."
kind: "surface"
state: "superseded"
publicness: "public"
availability: "universal"
dependencies: ["content.renderer.typed", "content.view.grouping-aggregation"]
related_features: []
roadmap_boundary: "superseded"
acceptance_summary: "No implementation should target this ambiguous umbrella; analytical rendering belongs to Chart View, semantic relationship exploration belongs to Graph View, and reusable compatibility/export mechanics belong to Typed Renderers."
proof_requirements:
  [
    "Every former analytical responsibility resolves to content.view.chart or content.renderer.typed",
    "Every former semantic-relationship responsibility resolves to content.view.graph",
    "No Feature or implementation treats this record as an active contract",
  ]
evidence: []
superseded_by: "content.view.chart"
last_reviewed: "2026-07-29"
---

# Collection graph renderers (superseded)

## Why this exists

The early catalog used `Graph` to mean both an analytical chart over grouped records and a semantic network of Pages and Relationships. Those are different user jobs, interaction models, dependencies, and proof gates. Keeping the umbrella active would make an implementer guess which meaning was intended.

## Example workflow

A developer asked to add a bar chart follows `content.view.chart`. A developer asked to let someone explore and edit `supports` relationships follows `content.view.graph`. Both reuse `content.renderer.typed` for compatibility, accessibility, and export behavior.

## Product contract

- `content.view.chart` owns analytical visualizations over typed Query results, grouping, measures, drill-down, saved Views, embedded Blocks, dashboards, and static output.
- `content.view.graph` owns query-selected canonical nodes, typed Relationship edges, semantic exploration, and authorized edge editing.
- `content.view.canvas` owns intentional spatial arrangement, view-local connectors, and explicit connector promotion.
- `content.renderer.typed` owns the shared renderer registry, typed compatibility, inheritance, accessible degradation, and export fallback.
- Authored Mermaid diagrams remain Code blocks with a Mermaid renderer; they are neither analytical Charts nor semantic Graphs.

## Boundaries and non-goals

- Do not add new dependencies, Features, or implementation evidence to this record.
- Do not use `Graph` as a synonym for `Chart` in new product contracts.
- Do not delete this record; it preserves stable-ID lineage for older references.

## Acceptance stories

### Route analytical work correctly

Given a change that renders grouped measures as bars, lines, or another statistical graphic, when product context is resolved, then the active contract is Chart View plus Typed Renderers and this record is not treated as implementable.

### Route semantic work correctly

Given a change that traverses or edits typed Page Relationships, when product context is resolved, then the active contract is Graph View plus the graph-query and Relationship capabilities.

## Current evidence

The modern catalog already contains separate Chart, Graph, Canvas, and Typed Renderer records. This lineage correction changes no runtime behavior and makes no implementation claim.

## Proof plan

Validate that no Feature requires this ID, repository guidance resolves both historical meanings to active records, generated projections label it superseded, and the dependency graph retains valid one-target lineage through `content.view.chart` while naming `content.view.graph` in this body.

## Open questions

The schema currently permits one `superseded_by` target. This record points to Chart because its original dependencies were analytical; the body preserves the separate Graph lineage. Supporting several replacement IDs may be considered later if the broader catalog needs it.
