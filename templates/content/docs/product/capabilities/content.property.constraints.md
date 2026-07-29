---
record_type: "capability"
id: "content.property.constraints"
name: "Property validation and defaults"
user_promise: "Required, default, validation, formatting, edit policy in column configuration"
kind: "primitive"
state: "approved_shape"
publicness: "public"
availability: "universal"
dependencies: ["content.property.typed","content.expression.language"]
related_features: ["content.feature.data-that-keeps-itself-right","content.feature.collect-structured-input"]
roadmap_boundary: "feature"
acceptance_summary: "A complete proof demonstrates: Atomic validation across every mutation path."
proof_requirements: ["Atomic validation across every mutation path."]
evidence: []
superseded_by: null
last_reviewed: "2026-07-29"
---

# Property validation and defaults

## Contract

Required, default, validation, formatting, edit policy in column configuration

## Acceptance boundary

A complete proof demonstrates: Atomic validation across every mutation path.

## Evidence boundary

Existing code may provide useful substrate, but this record is not verified until the complete atomic contract passes its proof requirements.

## Non-goals

This capability does not create a parallel datastore, permission model, or action surface.
