---
record_type: "capability"
id: "content.embed.host-grant"
name: "Embedded host grants"
user_promise: "An embedded host receives only the named mount and Action capabilities it needs and can never widen the signed-in viewer's authority."
kind: "primitive"
state: "approved_shape"
publicness: "public"
availability: "configured"
dependencies: ["content.embed.surface","content.access.visibility-closure"]
related_features: ["content.feature.work-on-content-inside-another-application"]
roadmap_boundary: "feature"
acceptance_summary: "A complete proof demonstrates: An embedded host receives only the named mount and Action capabilities it needs and can never widen the signed-in viewer's authority."
proof_requirements: ["An embedded host receives only the named mount and Action capabilities it needs and can never widen the signed-in viewer's authority."]
evidence: []
superseded_by: null
last_reviewed: "2026-07-29"
---

# Embedded host grants

## Contract

An embedded host receives only the named mount and Action capabilities it needs and can never widen the signed-in viewer's authority.

## Acceptance boundary

A complete proof demonstrates: An embedded host receives only the named mount and Action capabilities it needs and can never widen the signed-in viewer's authority.

## Evidence boundary

Existing code may provide useful substrate, but this record is not verified until the complete atomic contract passes its proof requirements.

## Non-goals

This capability does not create a parallel datastore, permission model, or action surface.
