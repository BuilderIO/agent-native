---
record_type: "capability"
id: "content.source.sync-policy"
name: "Source sync policy"
user_promise: "Each connected Source declares one plain-language truth policy: view only, keep in sync, or review before write-back."
kind: "primitive"
state: "approved_shape"
publicness: "public"
availability: "configured"
dependencies: ["content.source.catalog","content.event.committed"]
related_features: ["content.feature.trust-your-connected-sources","content.feature.bring-your-local-work"]
roadmap_boundary: "feature"
acceptance_summary: "A complete proof demonstrates: Each connected Source declares one plain-language truth policy: view only, keep in sync, or review before write-back."
proof_requirements: ["Each connected Source declares one plain-language truth policy: view only, keep in sync, or review before write-back."]
evidence: []
superseded_by: null
last_reviewed: "2026-07-29"
---

# Source sync policy

## Contract

Each connected Source declares one plain-language truth policy: view only, keep in sync, or review before write-back.

## Acceptance boundary

A complete proof demonstrates: Each connected Source declares one plain-language truth policy: view only, keep in sync, or review before write-back.

## Evidence boundary

Existing code may provide useful substrate, but this record is not verified until the complete atomic contract passes its proof requirements.

## Non-goals

This capability does not create a parallel datastore, permission model, or action surface.
