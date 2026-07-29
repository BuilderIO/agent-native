---
record_type: "capability"
id: "content.action.button"
name: "Action Buttons"
user_promise: "An owner-governed Button invokes an ordinary action/Rule with typed inputs and visible authority"
kind: "primitive"
state: "approved_shape"
publicness: "public"
availability: "universal"
dependencies: ["content.command.fabric","content.rule.deterministic"]
related_features: ["content.feature.when-this-happens-that-follows"]
roadmap_boundary: "feature"
acceptance_summary: "A complete proof demonstrates: Template insertion, access/edit restrictions, confirmation/undo, event and history receipt; no private button engine."
proof_requirements: ["Template insertion, access/edit restrictions, confirmation/undo, event and history receipt; no private button engine."]
evidence: []
superseded_by: null
last_reviewed: "2026-07-29"
---

# Action Buttons

## Contract

An owner-governed Button invokes an ordinary action/Rule with typed inputs and visible authority

## Acceptance boundary

A complete proof demonstrates: Template insertion, access/edit restrictions, confirmation/undo, event and history receipt; no private button engine.

## Evidence boundary

Existing code may provide useful substrate, but this record is not verified until the complete atomic contract passes its proof requirements.

## Non-goals

This capability does not create a parallel datastore, permission model, or action surface.
