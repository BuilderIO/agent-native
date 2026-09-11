---
record_type: "capability"
spec_version: 2
id: "content.system.task-project"
name: "Blessed Task and Project Template"
user_promise: "Blessed editable Task/Project template over Content"
primary_user_job: "Start a useful project system quickly, then adapt Tasks and Projects without forking into a separate task product."
kind: "workflow"
state: "approved_shape"
publicness: "public"
availability: "universal"
dependencies: ["content.template.graph", "content.view.fast-capture"]
related_features: ["content.feature.run-projects-your-way"]
roadmap_boundary: "feature"
acceptance_summary: "An editable Task/Project Template composes fast capture, dynamic Views and defaults, typed relations, Rules, status rendering, and History over canonical Content objects."
proof_requirements:
  [
    "Template install, editable schema/View provenance, Task/Project creation, and fast-capture coverage",
    "Relations, dynamic filters/defaults, Rules, status renderer, history, access, and recovery coverage",
    "Real-interface project workflow from capture through status, reload, and agent context",
  ]
evidence: []
superseded_by: null
last_reviewed: "2026-07-29"
---

# Blessed Task and Project Template

## Why this exists

People need a credible place to start projects, then room to make the system fit the work
without being trapped in a parallel task engine.

## Example workflow

A team instantiates the Template, captures a task from a List, assigns it to a Project,
uses a status View, and later adjusts the template's Properties and Views for its practice.

## Product contract

- The Template forks editable Task and Project configuration with provenance, not a possessed shared product type.
- Tasks, Projects, relations, Rules, status rendering, History, and Views use canonical Content objects and Actions.
- Dynamic filters and creation defaults are contextual helpers, never hidden validation or source-of-truth copies.
- Access, source policy, deletion, stale state, and recovery retain ordinary Content behavior.

## Boundaries and non-goals

Templates compose primitives; dependencies and scheduling have separate contracts. This is
not a fixed task taxonomy, a proprietary workflow engine, or a permission bypass.

## Acceptance stories

### Start then adapt

Given a new workspace, when an editor instantiates the Template and later changes a View,
then canonical task/project identity and template provenance remain intact.

### Capture into a project

Given an authorized fast List, when a person captures a task and assigns its Project,
then shared Actions apply defaults, Rules, history, and access without creating a duplicate.

## Current evidence

Existing Template and Database machinery are donor substrate, but the complete Task/Project
workflow is not yet proven. This Capability remains `approved_shape`.

## Proof plan

1. Test instantiation, provenance, editable schema and Views, and fast capture.
2. Verify relations, Rules, defaults, status, history, access, deletion, and recovery.
3. Exercise capture-to-project-to-status through UI and agent context after reload.

## Open questions

The initial Task/Project Property set and opinionated Views need Template design.
