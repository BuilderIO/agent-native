---
record_type: "capability"
id: "content.agent.audience-safe"
name: "Audience-safe synthesis"
user_promise: "A governed agent run can restrict its inputs to information every intended viewer of the output may access."
kind: "workflow"
state: "approved_shape"
publicness: "public"
availability: "universal"
dependencies: ["content.agent.resource-consent","content.access.visibility-closure"]
related_features: ["content.feature.keep-your-private-vault-private"]
roadmap_boundary: "feature"
acceptance_summary: "A complete proof demonstrates: A governed agent run can restrict its inputs to information every intended viewer of the output may access."
proof_requirements: ["A governed agent run can restrict its inputs to information every intended viewer of the output may access."]
evidence: []
superseded_by: null
last_reviewed: "2026-07-29"
---

# Audience-safe synthesis

## Contract

A governed agent run can restrict its inputs to information every intended viewer of the output may access.

## Acceptance boundary

A complete proof demonstrates: A governed agent run can restrict its inputs to information every intended viewer of the output may access.

## Evidence boundary

Existing code may provide useful substrate, but this record is not verified until the complete atomic contract passes its proof requirements.

## Non-goals

This capability does not create a parallel datastore, permission model, or action surface.
