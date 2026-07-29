---
record_type: "capability"
id: "content.workspace.working-set"
name: "Working set"
user_promise: "Tabs, split panes, and later windows are views over one persisted working set with explicit agent scope"
kind: "primitive"
state: "approved_shape"
publicness: "public"
availability: "universal"
dependencies: ["content.workspace.multi-scope"]
related_features: ["content.feature.find-your-place-again"]
roadmap_boundary: "feature"
acceptance_summary: "A complete proof demonstrates: Stable view references/state, lazy rendering, focus/selection, workspace/source boundaries."
proof_requirements: ["Stable view references/state, lazy rendering, focus/selection, workspace/source boundaries."]
evidence: []
superseded_by: null
last_reviewed: "2026-07-29"
---

# Working set

## Contract

Tabs, split panes, and later windows are views over one persisted working set with explicit agent scope

## Acceptance boundary

A complete proof demonstrates: Stable view references/state, lazy rendering, focus/selection, workspace/source boundaries.

## Evidence boundary

Existing code may provide useful substrate, but this record is not verified until the complete atomic contract passes its proof requirements.

## Non-goals

This capability does not create a parallel datastore, permission model, or action surface.
