---
record_type: "capability"
id: "content.form.shared-engine"
name: "Shared Form engine"
user_promise: "Content Form Views and Agent Native Forms use one schema, validation, permission, and idempotent submission engine."
kind: "surface"
state: "approved_shape"
publicness: "public"
availability: "universal"
dependencies: ["content.property.constraints","content.agent.action-parity","content.event.committed"]
related_features: ["content.feature.collect-structured-input"]
roadmap_boundary: "feature"
acceptance_summary: "A complete proof demonstrates: Content Form Views and Agent Native Forms use one schema, validation, permission, and idempotent submission engine."
proof_requirements: ["Content Form Views and Agent Native Forms use one schema, validation, permission, and idempotent submission engine."]
evidence: []
superseded_by: null
last_reviewed: "2026-07-29"
---

# Shared Form engine

## Contract

Content Form Views and Agent Native Forms use one schema, validation, permission, and idempotent submission engine.

## Acceptance boundary

A complete proof demonstrates: Content Form Views and Agent Native Forms use one schema, validation, permission, and idempotent submission engine.

## Evidence boundary

Existing code may provide useful substrate, but this record is not verified until the complete atomic contract passes its proof requirements.

## Non-goals

This capability does not create a parallel datastore, permission model, or action surface.
