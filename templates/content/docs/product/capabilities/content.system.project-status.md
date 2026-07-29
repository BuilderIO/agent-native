---
record_type: "capability"
id: "content.system.project-status"
name: "Project status"
user_promise: "Project status updates and rollups as ordinary Content views/pages"
kind: "workflow"
state: "approved_shape"
publicness: "public"
availability: "universal"
dependencies: ["content.system.task-project","content.view.grouping-aggregation"]
related_features: ["content.feature.run-projects-your-way"]
roadmap_boundary: "feature"
acceptance_summary: "A complete proof demonstrates: Task/project relations, access-safe aggregation, schedules/reminders, renderers."
proof_requirements: ["Task/project relations, access-safe aggregation, schedules/reminders, renderers."]
evidence: []
superseded_by: null
last_reviewed: "2026-07-29"
---

# Project status

## Contract

Project status updates and rollups as ordinary Content views/pages

## Acceptance boundary

A complete proof demonstrates: Task/project relations, access-safe aggregation, schedules/reminders, renderers.

## Evidence boundary

Existing code may provide useful substrate, but this record is not verified until the complete atomic contract passes its proof requirements.

## Non-goals

This capability does not create a parallel datastore, permission model, or action surface.
