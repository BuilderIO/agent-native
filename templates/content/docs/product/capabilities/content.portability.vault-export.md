---
record_type: "capability"
id: "content.portability.vault-export"
name: "Whole-vault export"
user_promise: "An authorized person can export a static snapshot as an open vault, a lossless Content archive, or a destination-specific package."
kind: "workflow"
state: "approved_shape"
publicness: "public"
availability: "universal"
dependencies: ["content.portability.roundtrip","content.job.durable","content.access.visibility-closure"]
related_features: ["content.feature.bring-your-local-work","content.feature.take-the-whole-vault-with-you","content.feature.keep-your-private-vault-private"]
roadmap_boundary: "feature"
acceptance_summary: "A complete proof demonstrates: An authorized person can export a static snapshot as an open vault, a lossless Content archive, or a destination-specific package."
proof_requirements: ["An authorized person can export a static snapshot as an open vault, a lossless Content archive, or a destination-specific package."]
evidence: []
superseded_by: null
last_reviewed: "2026-07-29"
---

# Whole-vault export

## Contract

An authorized person can export a static snapshot as an open vault, a lossless Content archive, or a destination-specific package.

## Acceptance boundary

A complete proof demonstrates: An authorized person can export a static snapshot as an open vault, a lossless Content archive, or a destination-specific package.

## Evidence boundary

Existing code may provide useful substrate, but this record is not verified until the complete atomic contract passes its proof requirements.

## Non-goals

This capability does not create a parallel datastore, permission model, or action surface.
