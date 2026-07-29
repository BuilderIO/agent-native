---
record_type: "capability"
id: "content.view.renderer-conformance"
name: "View renderer conformance"
user_promise: "Every View obeys the same permissions, Actions, agent context, accessibility, persistence, performance, and recovery contract."
kind: "surface"
state: "approved_shape"
publicness: "public"
availability: "universal"
dependencies: ["content.renderer.typed","content.view.query"]
related_features: ["content.feature.see-your-information-your-way"]
roadmap_boundary: "feature"
acceptance_summary: "A complete proof demonstrates: Every View obeys the same permissions, Actions, agent context, accessibility, persistence, performance, and recovery contract."
proof_requirements: ["Every View obeys the same permissions, Actions, agent context, accessibility, persistence, performance, and recovery contract."]
evidence: []
superseded_by: null
last_reviewed: "2026-07-29"
---

# View renderer conformance

## Contract

Every View obeys the same permissions, Actions, agent context, accessibility, persistence, performance, and recovery contract.

## Acceptance boundary

A complete proof demonstrates: Every View obeys the same permissions, Actions, agent context, accessibility, persistence, performance, and recovery contract.

## Evidence boundary

Existing code may provide useful substrate, but this record is not verified until the complete atomic contract passes its proof requirements.

## Non-goals

This capability does not create a parallel datastore, permission model, or action surface.
