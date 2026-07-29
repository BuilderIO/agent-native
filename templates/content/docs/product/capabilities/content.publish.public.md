---
record_type: "capability"
id: "content.publish.public"
name: "Public publishing"
user_promise: "Internal sharing and public publishing remain separate, explicit, auditable planes"
kind: "surface"
state: "approved_shape"
publicness: "public"
availability: "universal"
dependencies: ["content.publish.reading","content.access.visibility-closure","content.event.committed"]
related_features: ["content.feature.publish-with-confidence"]
roadmap_boundary: "feature"
acceptance_summary: "A complete proof demonstrates: Share-state language, polished landing/reading, request-access completion path, exposure inventory, private-asset warnings."
proof_requirements: ["Share-state language, polished landing/reading, request-access completion path, exposure inventory, private-asset warnings."]
evidence: []
superseded_by: null
last_reviewed: "2026-07-29"
---

# Public publishing

## Contract

Internal sharing and public publishing remain separate, explicit, auditable planes

## Acceptance boundary

A complete proof demonstrates: Share-state language, polished landing/reading, request-access completion path, exposure inventory, private-asset warnings.

## Evidence boundary

Existing code may provide useful substrate, but this record is not verified until the complete atomic contract passes its proof requirements.

## Non-goals

This capability does not create a parallel datastore, permission model, or action surface.
