---
record_type: "capability"
id: "content.diff.in-place"
name: "In-place typed review"
user_promise: "Typed changes rendered inside the ordinary editor/view"
kind: "primitive"
state: "approved_shape"
publicness: "public"
availability: "universal"
dependencies: ["content.event.committed","content.renderer.typed"]
related_features: ["content.feature.review-changes-in-place","content.feature.explore-alternatives-safely","content.feature.evolve-systems-safely"]
roadmap_boundary: "feature"
acceptance_summary: "A complete proof demonstrates: Change identity/dependencies, inline renderers, durable review decisions."
proof_requirements: ["Change identity/dependencies, inline renderers, durable review decisions."]
evidence: []
superseded_by: null
last_reviewed: "2026-07-29"
---

# In-place typed review

## Contract

Typed changes rendered inside the ordinary editor/view

## Acceptance boundary

A complete proof demonstrates: Change identity/dependencies, inline renderers, durable review decisions.

## Evidence boundary

Existing code may provide useful substrate, but this record is not verified until the complete atomic contract passes its proof requirements.

## Non-goals

This capability does not create a parallel datastore, permission model, or action surface.
