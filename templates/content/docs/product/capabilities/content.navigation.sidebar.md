---
record_type: "capability"
id: "content.navigation.sidebar"
name: "Personal sidebar"
user_promise: "The sidebar is a personal navigation surface with pinned references and query-backed dynamic sections, not object hierarchy."
kind: "surface"
state: "approved_shape"
publicness: "public"
availability: "universal"
dependencies: ["content.object.reference","content.query.object"]
related_features: ["content.feature.find-your-place-again","content.feature.make-the-workspace-yours"]
roadmap_boundary: "feature"
acceptance_summary: "A complete proof demonstrates: The sidebar is a personal navigation surface with pinned references and query-backed dynamic sections, not object hierarchy."
proof_requirements: ["The sidebar is a personal navigation surface with pinned references and query-backed dynamic sections, not object hierarchy."]
evidence: []
superseded_by: null
last_reviewed: "2026-07-29"
---

# Personal sidebar

## Contract

The sidebar is a personal navigation surface with pinned references and query-backed dynamic sections, not object hierarchy.

## Acceptance boundary

A complete proof demonstrates: The sidebar is a personal navigation surface with pinned references and query-backed dynamic sections, not object hierarchy.

## Evidence boundary

Existing code may provide useful substrate, but this record is not verified until the complete atomic contract passes its proof requirements.

## Non-goals

This capability does not create a parallel datastore, permission model, or action surface.
