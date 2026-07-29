---
record_type: "capability"
id: "content.access.row-private"
name: "Row-level privacy"
user_promise: "Row/Page sharing can override inherited Database visibility"
kind: "primitive"
state: "approved_shape"
publicness: "public"
availability: "universal"
dependencies: ["content.access.page-database"]
related_features: ["content.feature.explore-alternatives-safely"]
roadmap_boundary: "feature"
acceptance_summary: "A complete proof demonstrates: Default inheritance, per-row principals, query behavior, source sync."
proof_requirements: ["Default inheritance, per-row principals, query behavior, source sync."]
evidence: []
superseded_by: null
last_reviewed: "2026-07-29"
---

# Row-level privacy

## Contract

Row/Page sharing can override inherited Database visibility

## Acceptance boundary

A complete proof demonstrates: Default inheritance, per-row principals, query behavior, source sync.

## Evidence boundary

Existing code may provide useful substrate, but this record is not verified until the complete atomic contract passes its proof requirements.

## Non-goals

This capability does not create a parallel datastore, permission model, or action surface.
