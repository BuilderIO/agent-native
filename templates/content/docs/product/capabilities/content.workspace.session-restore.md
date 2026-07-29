---
record_type: "capability"
id: "content.workspace.session-restore"
name: "Session resumption"
user_promise: "Content reopens the authorized object and focused View a person was using without requiring them to reconstruct the route."
kind: "surface"
state: "approved_shape"
publicness: "public"
availability: "universal"
dependencies: ["content.workspace.working-set"]
related_features: ["content.feature.find-your-place-again"]
roadmap_boundary: "feature"
acceptance_summary: "A complete proof demonstrates that authorized navigation and focused View state survive a normal interruption and inaccessible state is discarded safely."
proof_requirements: ["Reopen the last authorized object and focused View after a normal application restart without leaking or reviving inaccessible state."]
evidence: []
superseded_by: null
last_reviewed: "2026-07-29"
---

# Session resumption

## Contract

Content reopens the authorized object and focused View a person was using without requiring them to reconstruct the route.

## Acceptance boundary

A complete proof covers restart, stale or deleted objects, changed permissions, and restoration of the focused saved or personal View.

## Evidence boundary

Persisted navigation donors do not verify this contract until the full return workflow passes.

## Non-goals

Session resumption does not preserve unauthorized data or keep every inactive renderer mounted.
