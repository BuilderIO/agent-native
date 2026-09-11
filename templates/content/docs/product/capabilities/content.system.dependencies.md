---
record_type: "capability"
spec_version: 2
id: "content.system.dependencies"
name: "Task dependencies"
user_promise: "Parent/subtask and blocked/blocking relations with constraints"
primary_user_job: "Express what contains or blocks work and see trustworthy consequences across project and planning Views."
kind: "workflow"
state: "approved_shape"
publicness: "public"
availability: "universal"
dependencies: ["content.relationship.edge", "content.expression.language"]
related_features:
  [
    "content.feature.run-projects-your-way",
    "content.feature.plan-work-across-time",
  ]
roadmap_boundary: "feature"
acceptance_summary: "Task hierarchy and blocking are typed Relationships with inverse, cardinality, self-edge, and cycle rules; expressions and planning consume those edges rather than copied dependency fields."
proof_requirements:
  [
    "Typed dependency and hierarchy create, inverse, cardinality, self-edge, cycle, and deletion coverage",
    "Access-safe Relationship Actions, expressions, rollups, history, and recovery coverage",
    "Project, List, Timeline, and agent-context workflow with unavailable or stale relations",
  ]
evidence: []
superseded_by: null
last_reviewed: "2026-07-29"
---

# Task dependencies

## Why this exists

Projects need to say what blocks what without making a task dependency engine that drifts
away from the rest of Content.

## Example workflow

An editor marks one task as blocking another and groups subtasks beneath a parent. The
same typed edges inform task Views, expressions, and later scheduling surfaces.

## Product contract

- Parent/subtask and blocked/blocking are canonical typed Relationships with declared inverses and constraints.
- Creation and edits use the shared Relationship Action, access checks, history, and recovery.
- Expressions and scheduling consume canonical edges; Views project them without copying dependency truth.
- Cycles, self-relations, cardinality, missing endpoints, and inaccessible endpoints receive explicit policy.

## Boundaries and non-goals

Relationships own edges; schedule constraints consume them. This is not a Page-parent
system, a hidden status mutation engine, or a parallel task graph.

## Acceptance stories

### Reject a forbidden cycle

Given a relationship type that forbids cycles, when an editor creates a blocking cycle,
then the shared Action rejects it with an actionable explanation and no partial edge.

### Project an authorized blocker

Given a task whose blocker is inaccessible, when a viewer opens a task View, then no
endpoint title, count, or inference leaks through dependency presentation.

## Current evidence

Relationship and expression primitives are prerequisite substrate; no complete task
dependency workflow is proven. This Capability remains `approved_shape`.

## Proof plan

1. Test inverse, self-edge, cardinality, cycle, deletion, and concurrent relationship edits.
2. Verify access closure, expressions, history, agent context, and recovery.
3. Exercise List, project, Timeline, unavailable-relation, and keyboard workflows.

## Open questions

Which dependency types are blessed by the initial Task template needs template design.
