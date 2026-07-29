---
record_type: "capability"
id: "content.api.cms"
name: "Content API and CMS"
user_promise: "External clients and websites can read and mutate Content through the same typed Actions, permissions, validation, and audit behavior as people and agents."
kind: "surface"
state: "approved_shape"
publicness: "public"
availability: "universal"
dependencies: ["content.agent.action-parity","content.access.page-database"]
related_features: []
roadmap_boundary: "supporting"
acceptance_summary: "A complete proof demonstrates: External clients and websites can read and mutate Content through the same typed Actions, permissions, validation, and audit behavior as people and agents."
proof_requirements: ["External clients and websites can read and mutate Content through the same typed Actions, permissions, validation, and audit behavior as people and agents."]
evidence: []
superseded_by: null
last_reviewed: "2026-07-29"
---

# Content API and CMS

## Contract

External clients and websites can read and mutate Content through the same typed Actions, permissions, validation, and audit behavior as people and agents.

## Acceptance boundary

A complete proof demonstrates: External clients and websites can read and mutate Content through the same typed Actions, permissions, validation, and audit behavior as people and agents.

## Evidence boundary

Existing code may provide useful substrate, but this record is not verified until the complete atomic contract passes its proof requirements.

## Non-goals

This capability does not create a parallel datastore, permission model, or action surface.
