---
record_type: "capability"
id: "content.expression.cached-result"
name: "Cached expression results"
user_promise: "Content renders the last valid expression result immediately, marks it stale, and refreshes it without turning ordinary loading into an error."
kind: "primitive"
state: "approved_shape"
publicness: "public"
availability: "universal"
dependencies: ["content.expression.language","content.event.committed"]
related_features: ["content.feature.data-that-keeps-itself-right"]
roadmap_boundary: "feature"
acceptance_summary: "A complete proof demonstrates: Content renders the last valid expression result immediately, marks it stale, and refreshes it without turning ordinary loading into an error."
proof_requirements: ["Content renders the last valid expression result immediately, marks it stale, and refreshes it without turning ordinary loading into an error."]
evidence: []
superseded_by: null
last_reviewed: "2026-07-29"
---

# Cached expression results

## Contract

Content renders the last valid expression result immediately, marks it stale, and refreshes it without turning ordinary loading into an error.

## Acceptance boundary

A complete proof demonstrates: Content renders the last valid expression result immediately, marks it stale, and refreshes it without turning ordinary loading into an error.

## Evidence boundary

Existing code may provide useful substrate, but this record is not verified until the complete atomic contract passes its proof requirements.

## Non-goals

This capability does not create a parallel datastore, permission model, or action surface.
