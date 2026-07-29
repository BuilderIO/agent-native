---
record_type: "capability"
id: "content.portability.pdf-export"
name: "PDF and print export"
user_promise: "Real PDF export uses the same rendering truth as editor, reader, and HTML export"
kind: "primitive"
state: "approved_shape"
publicness: "public"
availability: "universal"
dependencies: ["content.renderer.typed","content.publish.reading"]
related_features: ["content.feature.publish-with-confidence","content.feature.take-the-whole-vault-with-you"]
roadmap_boundary: "feature"
acceptance_summary: "A complete proof demonstrates: Unified renderer, fonts/assets, math/diagrams/rich-block fidelity, deterministic failure/degradation."
proof_requirements: ["Unified renderer, fonts/assets, math/diagrams/rich-block fidelity, deterministic failure/degradation."]
evidence: []
superseded_by: null
last_reviewed: "2026-07-29"
---

# PDF and print export

## Contract

Real PDF export uses the same rendering truth as editor, reader, and HTML export

## Acceptance boundary

A complete proof demonstrates: Unified renderer, fonts/assets, math/diagrams/rich-block fidelity, deterministic failure/degradation.

## Evidence boundary

Existing code may provide useful substrate, but this record is not verified until the complete atomic contract passes its proof requirements.

## Non-goals

This capability does not create a parallel datastore, permission model, or action surface.
