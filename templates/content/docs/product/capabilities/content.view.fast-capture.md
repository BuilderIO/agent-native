---
record_type: "capability"
id: "content.view.fast-capture"
name: "Fast keyboard capture"
user_promise: "Keyboard-fluent List and Table capture"
kind: "surface"
state: "approved_shape"
publicness: "public"
availability: "universal"
dependencies: ["content.view.query","content.agent.action-parity"]
related_features: ["content.feature.see-your-information-your-way","content.feature.run-projects-your-way"]
roadmap_boundary: "feature"
acceptance_summary: "A complete proof demonstrates: Enter/Tab/navigation/editing behavior and optimistic rollback tests."
proof_requirements: ["Enter/Tab/navigation/editing behavior and optimistic rollback tests."]
evidence: []
superseded_by: null
last_reviewed: "2026-07-29"
---

# Fast keyboard capture

## Contract

Keyboard-fluent List and Table capture

## Acceptance boundary

A complete proof demonstrates: Enter/Tab/navigation/editing behavior and optimistic rollback tests.

## Evidence boundary

Existing code may provide useful substrate, but this record is not verified until the complete atomic contract passes its proof requirements.

## Non-goals

This capability does not create a parallel datastore, permission model, or action surface.
