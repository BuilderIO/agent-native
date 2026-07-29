---
record_type: "capability"
id: "content.share.views"
name: "Shared Views"
user_promise: "A shared Database view preserves its configuration while defaulting to the viewer's existing row access"
kind: "primitive"
state: "approved_shape"
publicness: "public"
availability: "universal"
dependencies: ["content.view.query","content.access.page-database"]
related_features: ["content.feature.make-the-workspace-yours"]
roadmap_boundary: "feature"
acceptance_summary: "A complete proof demonstrates: Intersection-by-default, explicit audited capability-view grants later, field projection, future-row semantics and revocation."
proof_requirements: ["Intersection-by-default, explicit audited capability-view grants later, field projection, future-row semantics and revocation."]
evidence: []
superseded_by: null
last_reviewed: "2026-07-29"
---

# Shared Views

## Contract

A shared Database view preserves its configuration while defaulting to the viewer's existing row access

## Acceptance boundary

A complete proof demonstrates: Intersection-by-default, explicit audited capability-view grants later, field projection, future-row semantics and revocation.

## Evidence boundary

Existing code may provide useful substrate, but this record is not verified until the complete atomic contract passes its proof requirements.

## Non-goals

This capability does not create a parallel datastore, permission model, or action surface.
