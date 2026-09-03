---
record_type: "capability"
spec_version: 2
id: "content.system.my-tasks"
name: "My Tasks"
user_promise: "“My Tasks” as an access-scoped dynamic saved view"
primary_user_job: "See the work assigned to me across eligible task memberships without maintaining a copied personal queue."
kind: "workflow"
state: "approved_shape"
publicness: "public"
availability: "universal"
dependencies: ["content.system.task-project", "content.view.query"]
related_features: ["content.feature.run-projects-your-way"]
roadmap_boundary: "feature"
acceptance_summary: "My Tasks is a fast, access-scoped saved View using current-user expressions across eligible task memberships and preserving each task's canonical origin."
proof_requirements:
  [
    "Current-user expression, multi-membership, sort, filter, and canonical-origin coverage",
    "Access-safe result, count, cross-context policy, Action, and agent-context coverage",
    "Real-interface fast List, empty, stale, unavailable, reload, and recovery workflow",
  ]
evidence: []
superseded_by: null
last_reviewed: "2026-07-29"
---

# My Tasks

## Why this exists

Assigned work should gather itself, not require a person to keep a second queue in sync.

## Example workflow

A contributor opens My Tasks, filters to due work, edits one task, and opens its Project.
The task remains its one canonical record in the source Database.

## Product contract

- My Tasks is a saved dynamic View using current-user expressions over eligible canonical task memberships.
- It evaluates access before results, counts, sort, filters, agent context, or cross-context display.
- Every row retains its task and project origin; edits use ordinary shared Actions.
- Empty, unavailable, stale, and revoked results are distinct from a complete empty queue.

## Boundaries and non-goals

The Task template defines task meaning and Queries define result execution. My Tasks is
not a copied inbox, assignment authority, or implicit cross-context search.

## Acceptance stories

### Gather assignments without duplication

Given assigned tasks in two eligible projects, when a person opens My Tasks, then each
authorized canonical task appears once according to saved View semantics.

### Remove revoked work

Given access to a task is revoked, when My Tasks refreshes, then that task and any count
or preview inference disappear from the person and agent context.

## Current evidence

No current-user cross-membership query and fast List proof is recorded. This Capability
remains `approved_shape`.

## Proof plan

1. Test current-user expressions, memberships, origin, filters, sort, and canonical edits.
2. Verify access, policy, counts, cross-context behavior, and agent disclosure.
3. Exercise fast List, empty, stale, unavailable, reload, and recovery workflows.

## Open questions

The default inclusion rule for unassigned and delegated tasks needs template design.
