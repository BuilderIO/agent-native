---
record_type: "capability"
id: "content.view.dynamic-create"
name: "View-derived creation defaults"
user_promise: "New rows inherit unambiguous equality constraints from the active view"
kind: "surface"
state: "approved_shape"
publicness: "public"
availability: "universal"
dependencies: ["content.view.query","content.property.constraints"]
related_features: ["content.feature.data-that-keeps-itself-right"]
roadmap_boundary: "feature"
acceptance_summary: "A complete proof demonstrates: Typed query analysis; refuse ambiguous OR/range/negation inference."
proof_requirements: ["Typed query analysis; refuse ambiguous OR/range/negation inference."]
evidence: []
superseded_by: null
last_reviewed: "2026-07-29"
---

# View-derived creation defaults

## Contract

New rows inherit unambiguous equality constraints from the active view

## Acceptance boundary

A complete proof demonstrates: Typed query analysis; refuse ambiguous OR/range/negation inference.

## Evidence boundary

Existing code may provide useful substrate, but this record is not verified until the complete atomic contract passes its proof requirements.

## Non-goals

This capability does not create a parallel datastore, permission model, or action surface.
