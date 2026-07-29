---
record_type: "capability"
id: "content.workspace.multi-scope"
name: "Personal and organization contexts"
user_promise: "One identity can hold personal Content plus several workspaces without account switching"
kind: "primitive"
state: "approved_shape"
publicness: "public"
availability: "universal"
dependencies: ["content.access.page-database"]
related_features: ["content.feature.find-your-place-again","content.feature.work-across-every-workspace"]
roadmap_boundary: "feature"
acceptance_summary: "A complete proof demonstrates: Visible current/global scope, opt-in cross-workspace retrieval, workspace opt-out policy, provenance and audit."
proof_requirements: ["Visible current/global scope, opt-in cross-workspace retrieval, workspace opt-out policy, provenance and audit."]
evidence: []
superseded_by: null
last_reviewed: "2026-07-29"
---

# Personal and organization contexts

## Contract

One identity can hold personal Content plus several workspaces without account switching

## Acceptance boundary

A complete proof demonstrates: Visible current/global scope, opt-in cross-workspace retrieval, workspace opt-out policy, provenance and audit.

## Evidence boundary

Existing code may provide useful substrate, but this record is not verified until the complete atomic contract passes its proof requirements.

## Non-goals

This capability does not create a parallel datastore, permission model, or action surface.
