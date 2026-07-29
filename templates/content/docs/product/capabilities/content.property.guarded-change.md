---
record_type: "capability"
id: "content.property.guarded-change"
name: "Guarded property changes"
user_promise: "Any Property can validate values and require an explained confirmation or policy check before a sensitive transition."
kind: "primitive"
state: "approved_shape"
publicness: "public"
availability: "universal"
dependencies: ["content.property.constraints","content.event.committed"]
related_features: ["content.feature.trust-your-connected-sources","content.feature.data-that-keeps-itself-right","content.feature.publish-with-confidence"]
roadmap_boundary: "feature"
acceptance_summary: "A complete proof demonstrates: Any Property can validate values and require an explained confirmation or policy check before a sensitive transition."
proof_requirements: ["Any Property can validate values and require an explained confirmation or policy check before a sensitive transition."]
evidence: []
superseded_by: null
last_reviewed: "2026-07-29"
---

# Guarded property changes

## Contract

Any Property can validate values and require an explained confirmation or policy check before a sensitive transition.

## Acceptance boundary

A complete proof demonstrates: Any Property can validate values and require an explained confirmation or policy check before a sensitive transition.

## Evidence boundary

Existing code may provide useful substrate, but this record is not verified until the complete atomic contract passes its proof requirements.

## Non-goals

This capability does not create a parallel datastore, permission model, or action surface.
