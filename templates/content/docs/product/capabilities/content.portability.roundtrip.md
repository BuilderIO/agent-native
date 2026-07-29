---
record_type: "capability"
id: "content.portability.roundtrip"
name: "Faithful round-tripping"
user_promise: "Canonical Content data imports/exports through humane Markdown/MDX and structured sidecars"
kind: "primitive"
state: "approved_shape"
publicness: "public"
availability: "universal"
dependencies: ["content.portability.source-representation"]
related_features: ["content.feature.trust-your-connected-sources","content.feature.cite-what-you-found","content.feature.take-the-whole-vault-with-you","content.feature.move-without-starting-over"]
roadmap_boundary: "feature"
acceptance_summary: "A complete proof demonstrates: Expressions/references/custom blocks/comments/block IDs need exact encodings."
proof_requirements: ["Expressions/references/custom blocks/comments/block IDs need exact encodings."]
evidence: []
superseded_by: null
last_reviewed: "2026-07-29"
---

# Faithful round-tripping

## Contract

Canonical Content data imports/exports through humane Markdown/MDX and structured sidecars

## Acceptance boundary

A complete proof demonstrates: Expressions/references/custom blocks/comments/block IDs need exact encodings.

## Evidence boundary

Existing code may provide useful substrate, but this record is not verified until the complete atomic contract passes its proof requirements.

## Non-goals

This capability does not create a parallel datastore, permission model, or action surface.
