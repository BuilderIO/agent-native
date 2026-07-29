---
record_type: "capability"
id: "content.security.private-vault"
name: "Private vault encryption"
user_promise: "User-held private-vault/E2EE custody with fail-closed enrollment, recovery, and authorization"
kind: "primitive"
state: "in_progress"
publicness: "public"
availability: "desktop"
dependencies: ["content.agent.resource-consent","content.portability.vault-export"]
related_features: ["content.feature.keep-your-private-vault-private"]
roadmap_boundary: "feature"
acceptance_summary: "A complete proof demonstrates: Protocol/implementation wayfinder, cross-architecture proof, recovery and agent-authority stories, merge and production gates."
proof_requirements: ["Protocol/implementation wayfinder, cross-architecture proof, recovery and agent-authority stories, merge and production gates."]
evidence: []
superseded_by: null
last_reviewed: "2026-07-29"
---

# Private vault encryption

## Contract

User-held private-vault/E2EE custody with fail-closed enrollment, recovery, and authorization

## Acceptance boundary

A complete proof demonstrates: Protocol/implementation wayfinder, cross-architecture proof, recovery and agent-authority stories, merge and production gates.

## Evidence boundary

Existing code may provide useful substrate, but this record is not verified until the complete atomic contract passes its proof requirements.

## Non-goals

This capability does not create a parallel datastore, permission model, or action surface.
