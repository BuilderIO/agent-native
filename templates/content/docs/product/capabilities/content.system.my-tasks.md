---
record_type: "capability"
id: "content.system.my-tasks"
name: "My Tasks"
user_promise: "“My Tasks” as an access-scoped dynamic saved view"
kind: "workflow"
state: "approved_shape"
publicness: "public"
availability: "universal"
dependencies: ["content.system.task-project","content.view.query"]
related_features: ["content.feature.run-projects-your-way"]
roadmap_boundary: "feature"
acceptance_summary: "A complete proof demonstrates: Current-user expressions, access-safe cross-membership query, fast List."
proof_requirements: ["Current-user expressions, access-safe cross-membership query, fast List."]
evidence: []
superseded_by: null
last_reviewed: "2026-07-29"
---

# My Tasks

## Contract

“My Tasks” as an access-scoped dynamic saved view

## Acceptance boundary

A complete proof demonstrates: Current-user expressions, access-safe cross-membership query, fast List.

## Evidence boundary

Existing code may provide useful substrate, but this record is not verified until the complete atomic contract passes its proof requirements.

## Non-goals

This capability does not create a parallel datastore, permission model, or action surface.
