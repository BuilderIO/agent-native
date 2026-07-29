---
record_type: "capability"
id: "content.system.dependencies"
name: "Task dependencies"
user_promise: "Parent/subtask and blocked/blocking relations with constraints"
kind: "workflow"
state: "approved_shape"
publicness: "public"
availability: "universal"
dependencies: ["content.relationship.edge","content.expression.language"]
related_features: ["content.feature.run-projects-your-way","content.feature.plan-work-across-time"]
roadmap_boundary: "feature"
acceptance_summary: "A complete proof demonstrates: Inverse/self-relations, cardinality, cycle rules, related-record expressions."
proof_requirements: ["Inverse/self-relations, cardinality, cycle rules, related-record expressions."]
evidence: []
superseded_by: null
last_reviewed: "2026-07-29"
---

# Task dependencies

## Contract

Parent/subtask and blocked/blocking relations with constraints

## Acceptance boundary

A complete proof demonstrates: Inverse/self-relations, cardinality, cycle rules, related-record expressions.

## Evidence boundary

Existing code may provide useful substrate, but this record is not verified until the complete atomic contract passes its proof requirements.

## Non-goals

This capability does not create a parallel datastore, permission model, or action surface.
