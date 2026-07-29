---
record_type: "capability"
spec_version: 2
id: "content.view.canvas"
name: "Canvas"
user_promise: "Canvas lets people intentionally arrange reusable Content objects in a spatial View without copying them or accidentally asserting semantic relationships."
primary_user_job: "Lay out notes, sources, media, and views to think visually, while deciding explicitly which tentative connections should become durable shared knowledge."
kind: "surface"
state: "approved_shape"
publicness: "public"
availability: "universal"
dependencies:
  [
    "content.object.reference",
    "content.relationship.edge",
    "content.view.query",
  ]
related_features: ["content.feature.sketch-connections-keep-whats-true"]
roadmap_boundary: "feature"
acceptance_summary: "Canvas stores an intentional View-local arrangement of canonical objects, sections, and freeform connectors; only an explicit promotion creates a typed Relationship, and its visual layout never changes shared semantics."
proof_requirements:
  [
    "Stable object reuse, multi-Canvas membership, position and section persistence, and canonical-record drill-in without copies",
    "View-local connector creation, editing, deletion, and explicit promotion to a selected typed Relationship",
    "Access-scoped placement, query-backed population, collaboration, deletion, unavailable-object, and recovery behavior",
    "Keyboard and assistive-technology spatial navigation plus bounded loading and real-interface arrangement workflows",
  ]
evidence: []
superseded_by: null
last_reviewed: "2026-07-29"
---

# Canvas

## Why this exists

People often need to arrange evidence, ideas, and work spatially before they know what every connection means. Canvas supplies that intentional visual workspace without copying the underlying Content objects or turning each sketch into a database fact. A line can remain a private-to-the-View thought until someone deliberately promotes it.

## Example workflow

A researcher drags canonical notes, source excerpts, images, and a saved query onto a Canvas. They place material into sections for competing explanations, draw informal lines between pieces of evidence, and add a small annotation. Once a line clearly means `contradicts`, they choose **Promote to relationship**, select that type, and confirm the authorized endpoints. The semantic edge then appears in Graph and Connections; removing the original Canvas line later does not remove it.

## Product contract

- Canvas is a View over reusable canonical Pages, Blocks, Sources, Annotations, media handles, and embedded Views. It owns placement, size, sections, stacks, presentation overrides, and view-local connectors, never a duplicate of the object’s data or identity.
- An object may appear in many Canvases. Moving, resizing, grouping, or removing its occurrence changes only that Canvas unless a separate canonical edit is made.
- Drawing a freeform line creates a view-local connector by default. It may be renamed, styled, moved, or deleted without invoking the Relationship system.
- **Promote to relationship** requires an explicit typed Relationship selection and an authorized shared mutation. Promotion creates or connects to the canonical edge; it does not silently reinterpret every similar line.
- A Canvas may intentionally show canonical semantic edges alongside freeform connectors, but the two remain distinguishable and independently editable.
- A Canvas may populate from an authorized saved query and may filter, group, or style visible semantic edges by type. Query membership does not give the Canvas authority to change source records.
- Manual arrangement, mind-map hierarchy, and optional auto-layout adjust View-owned layout only. They never manufacture or rewrite semantic Relationships.
- Canvas preserves an honest distinction among removed objects, inaccessible objects, unavailable sources, and empty query results; it does not convert each into a generic blank card.

## Boundaries and non-goals

- `content.view.graph` owns semantic relationship exploration and editing over a relationship query; Canvas is not a semantic Graph mode.
- `content.relationship.edge` owns canonical typed edges and their authorization. Canvas owns draft connector lifecycle and invokes that Capability only on explicit promotion.
- `content.view.query` owns typed query definitions and access-scoped result contracts; Canvas consumes authorized results.
- `content.view.chart` owns analytical charts, and Mermaid remains an authored code diagram rather than a Canvas feature.
- Canvas does not create a parallel datastore, permissions model, relationship inference engine, or a promise that every spatial arrangement is a shared semantic model.

## Acceptance stories

### Reuse one object in two contexts

Given a Page placed on two Canvases, when an editor rearranges it or removes it from one Canvas, then the other Canvas and the canonical Page stay unchanged. Opening either occurrence reaches the same authorized record.

### Keep brainstorming local until promotion

Given two objects connected by a freeform Canvas line, when a contributor deletes or restyles the line, then no canonical Relationship changes. When they explicitly promote it with an authorized `supports` type, then one typed edge is created and remains after the local line is removed.

### Preserve access and source truth

Given a query-populated Canvas whose source later becomes unavailable and one result becomes inaccessible, when the viewer returns, then Canvas identifies each condition without leaking the inaccessible object or silently presenting the unavailable query as empty.

### Collaborate without layout becoming a semantic conflict

Given two collaborators arranging the same Canvas while one edits a canonical Relationship through another authorized surface, when changes settle, then layout updates merge or surface a recoverable View conflict and the canonical relationship retains its own history.

## Current evidence

Existing object references, Views, and relationship concepts are useful substrate. There is no current evidence that proves multi-Canvas identity, connector promotion, collaboration, access closure, or accessible spatial interaction as one complete workflow. This Capability remains `approved_shape`.

## Proof plan

1. Place each supported object kind in multiple Canvases, edit its canonical source, and verify occurrence reuse, source truth, deletion, and restoration behavior.
2. Create, edit, remove, and promote freeform connectors; prove that only explicit typed promotion invokes the Relationship Action and that visual deletion never removes an edge.
3. Exercise query-backed population, filters, semantic-edge overlays, empty results, access changes, source unavailability, bounded loading, and retry.
4. Test concurrent arrangement, section changes, stack changes, and canonical edits with durable history and recovery behavior.
5. Complete keyboard and assistive-technology workflows for placement, selection, grouping, connectors, promotion, errors, and opening canonical records.

## Open questions

The exact spatial input model, collision behavior, collaboration merge representation, and supported media affordances remain implementation choices. They must not weaken object reuse, explicit promotion, access closure, or layout-only semantics.
