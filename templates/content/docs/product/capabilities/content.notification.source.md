---
record_type: "capability"
id: "content.notification.source"
name: "Notifications"
user_promise: "Canonical notifications exposed as queryable Content source/views"
kind: "primitive"
state: "approved_shape"
publicness: "public"
availability: "universal"
dependencies: ["content.event.committed"]
related_features: ["content.feature.collaborate-in-context","content.feature.run-projects-your-way"]
roadmap_boundary: "feature"
acceptance_summary: "A complete proof demonstrates: Stable identity/read/archive state, access, routing Rules, My Tasks remains separate."
proof_requirements: ["Stable identity/read/archive state, access, routing Rules, My Tasks remains separate."]
evidence: []
superseded_by: null
last_reviewed: "2026-07-29"
---

# Notifications

## Contract

Canonical notifications exposed as queryable Content source/views

## Acceptance boundary

A complete proof demonstrates: Stable identity/read/archive state, access, routing Rules, My Tasks remains separate.

## Evidence boundary

Existing code may provide useful substrate, but this record is not verified until the complete atomic contract passes its proof requirements.

## Non-goals

This capability does not create a parallel datastore, permission model, or action surface.
