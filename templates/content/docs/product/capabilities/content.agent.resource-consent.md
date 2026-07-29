---
record_type: "capability"
id: "content.agent.resource-consent"
name: "Agent resource consent"
user_promise: "Resources independently declare whether agents may use them as context and whether agents may edit them, with inheritable policy ceilings."
kind: "primitive"
state: "approved_shape"
publicness: "public"
availability: "universal"
dependencies: ["content.access.page-database","content.event.committed"]
related_features: ["content.feature.keep-your-private-vault-private"]
roadmap_boundary: "feature"
acceptance_summary: "A complete proof demonstrates: Resources independently declare whether agents may use them as context and whether agents may edit them, with inheritable policy ceilings."
proof_requirements: ["Resources independently declare whether agents may use them as context and whether agents may edit them, with inheritable policy ceilings."]
evidence: []
superseded_by: null
last_reviewed: "2026-07-29"
---

# Agent resource consent

## Contract

Resources independently declare whether agents may use them as context and whether agents may edit them, with inheritable policy ceilings.

## Acceptance boundary

A complete proof demonstrates: Resources independently declare whether agents may use them as context and whether agents may edit them, with inheritable policy ceilings.

## Evidence boundary

Existing code may provide useful substrate, but this record is not verified until the complete atomic contract passes its proof requirements.

## Non-goals

This capability does not create a parallel datastore, permission model, or action surface.
