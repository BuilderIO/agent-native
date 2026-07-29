---
record_type: "capability"
id: "content.source.local-bridge"
name: "Local Source bridge"
user_promise: "A desktop app or small trusted service can synchronize selected local Sources for browsers that cannot access files directly."
kind: "surface"
state: "approved_shape"
publicness: "public"
availability: "desktop"
dependencies: ["content.source.adapters","content.source.sync-policy"]
related_features: ["content.feature.bring-your-local-work","content.feature.take-the-whole-vault-with-you","content.feature.keep-your-private-vault-private"]
roadmap_boundary: "feature"
acceptance_summary: "A complete proof demonstrates: A desktop app or small trusted service can synchronize selected local Sources for browsers that cannot access files directly."
proof_requirements: ["A desktop app or small trusted service can synchronize selected local Sources for browsers that cannot access files directly."]
evidence: []
superseded_by: null
last_reviewed: "2026-07-29"
---

# Local Source bridge

## Contract

A desktop app or small trusted service can synchronize selected local Sources for browsers that cannot access files directly.

## Acceptance boundary

A complete proof demonstrates: A desktop app or small trusted service can synchronize selected local Sources for browsers that cannot access files directly.

## Evidence boundary

Existing code may provide useful substrate, but this record is not verified until the complete atomic contract passes its proof requirements.

## Non-goals

This capability does not create a parallel datastore, permission model, or action surface.
