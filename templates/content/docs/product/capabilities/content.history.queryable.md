---
record_type: "capability"
id: "content.history.queryable"
name: "History"
user_promise: "Full-height queryable History surface over revisions/events"
kind: "primitive"
state: "approved_shape"
publicness: "public"
availability: "universal"
dependencies: ["content.event.committed"]
related_features: ["content.feature.durable-foundations","content.feature.review-changes-in-place"]
roadmap_boundary: "feature"
acceptance_summary: "A complete proof demonstrates: Event spine, revision payload boundaries, access, filter/group/sort, body/property diff rendering."
proof_requirements: ["Event spine, revision payload boundaries, access, filter/group/sort, body/property diff rendering."]
evidence: []
superseded_by: null
last_reviewed: "2026-07-29"
---

# History

## Contract

Full-height queryable History surface over revisions/events

## Acceptance boundary

A complete proof demonstrates: Event spine, revision payload boundaries, access, filter/group/sort, body/property diff rendering.

## Evidence boundary

Existing code may provide useful substrate, but this record is not verified until the complete atomic contract passes its proof requirements.

## Non-goals

This capability does not create a parallel datastore, permission model, or action surface.
