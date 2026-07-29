---
record_type: "capability"
id: "content.object.blocks-field"
name: "Blocks fields"
user_promise: "Every editable rich-content body uses the same Blocks-field grammar and owns its own stable revision history."
kind: "primitive"
state: "approved_shape"
publicness: "public"
availability: "universal"
dependencies: ["content.object.block"]
related_features: ["content.feature.durable-foundations","content.feature.collaborate-in-context"]
roadmap_boundary: "feature"
acceptance_summary: "A complete proof demonstrates: Every editable rich-content body uses the same Blocks-field grammar and owns its own stable revision history."
proof_requirements: ["Every editable rich-content body uses the same Blocks-field grammar and owns its own stable revision history."]
evidence: []
superseded_by: null
last_reviewed: "2026-07-29"
---

# Blocks fields

## Contract

Every editable rich-content body uses the same Blocks-field grammar and owns its own stable revision history.

## Acceptance boundary

A complete proof demonstrates: Every editable rich-content body uses the same Blocks-field grammar and owns its own stable revision history.

## Evidence boundary

Existing code may provide useful substrate, but this record is not verified until the complete atomic contract passes its proof requirements.

## Non-goals

This capability does not create a parallel datastore, permission model, or action surface.
