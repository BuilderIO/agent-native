---
record_type: "capability"
spec_version: 2
id: "content.system.project-status"
name: "Project status"
user_promise: "Project status updates and rollups as ordinary Content views/pages"
primary_user_job: "Understand a project's current state and next concern from canonical tasks and updates without a separate reporting system."
kind: "workflow"
state: "approved_shape"
publicness: "public"
availability: "universal"
dependencies:
  ["content.system.task-project", "content.view.grouping-aggregation"]
related_features: ["content.feature.run-projects-your-way"]
roadmap_boundary: "feature"
acceptance_summary: "Project Pages and ordinary Views compose canonical task relationships, access-safe rollups, status updates, schedules or reminders, and suitable renderers."
proof_requirements:
  [
    "Task/project relation, status update, rollup, and canonical drill-in coverage",
    "Access-safe aggregation, schedule/reminder policy, Actions, history, and recovery coverage",
    "Real-interface project status, empty/stale/unavailable, renderer, and agent-context workflow",
  ]
evidence: []
superseded_by: null
last_reviewed: "2026-07-29"
---

# Project status

## Why this exists

A status page should tell a truthful story from work already happening, not become an
orphaned dashboard that someone must remember to reconcile.

## Example workflow

A lead opens a Project Page, reads its latest update and access-safe task rollup, drills
into a concerning group, and schedules a reminder through the project's ordinary rules.

## Product contract

- Project status is composed from canonical Task/Project relations, Pages, Views, and access-safe aggregates.
- Status updates remain ordinary attributable Content with history and permissions.
- Rollups and drill-in evaluate access before measures, labels, counts, reminders, exports, or agent context.
- Empty, stale, unavailable, and partially complete inputs are represented truthfully.

## Boundaries and non-goals

Task templates own task shape; grouping owns measures. This is not a separate reporting
warehouse, management-only data model, or inferred status authority.

## Acceptance stories

### Read a safe project rollup

Given a Project with private tasks, when a viewer opens its status, then rollups and
counts include only authorized task information and drill-in remains scoped.

### Publish an update canonically

Given an authorized project editor, when they add a status update, then it is an ordinary
attributable Content change with history and no copied dashboard record.

## Current evidence

No complete project status composition, aggregation, reminder, and renderer proof is
recorded. This Capability remains `approved_shape`.

## Proof plan

1. Test task/project relations, updates, rollups, drill-in, and status history.
2. Verify access, reminders, exports, agents, stale inputs, and recovery.
3. Exercise project Page and renderer workflows under empty and unavailable conditions.

## Open questions

The initial status vocabulary and reminder integration policy need template design.
