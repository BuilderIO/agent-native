---
record_type: "capability"
id: "content.view.query"
name: "Database and Query Views"
user_promise: "Saved typed queries rendered as Table/Board/List/Gallery/Calendar/Timeline/Form/Sidebar and later Graph/Canvas views"
kind: "surface"
state: "approved_shape"
publicness: "public"
availability: "universal"
dependencies: ["content.query.object","content.property.typed"]
related_features: ["content.feature.make-the-workspace-yours","content.feature.see-your-information-your-way","content.feature.understand-what-your-data-says"]
roadmap_boundary: "feature"
acceptance_summary: "A complete proof demonstrates: Reconcile existing filter grammar into typed expressions without breaking saved views. Resolve local and source-backed properties by stable identity, never display name alone; expose source/membership provenance in cross-Database queries; support explicit query-local field unions and ambiguity repair without introducing a normal-user shared-definition system."
proof_requirements: ["Reconcile existing filter grammar into typed expressions without breaking saved views. Resolve local and source-backed properties by stable identity, never display name alone; expose source/membership provenance in cross-Database queries; support explicit query-local field unions and ambiguity repair without introducing a normal-user shared-definition system."]
evidence: []
superseded_by: null
last_reviewed: "2026-07-29"
---

# Database and Query Views

## Contract

Saved typed queries rendered as Table/Board/List/Gallery/Calendar/Timeline/Form/Sidebar and later Graph/Canvas views

## Acceptance boundary

A complete proof demonstrates: Reconcile existing filter grammar into typed expressions without breaking saved views. Resolve local and source-backed properties by stable identity, never display name alone; expose source/membership provenance in cross-Database queries; support explicit query-local field unions and ambiguity repair without introducing a normal-user shared-definition system.

## Evidence boundary

Existing code may provide useful substrate, but this record is not verified until the complete atomic contract passes its proof requirements.

## Non-goals

This capability does not create a parallel datastore, permission model, or action surface.
