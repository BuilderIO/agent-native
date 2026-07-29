---
record_type: "capability"
id: "content.object.transclusion"
name: "Synced Blocks and live embeds"
user_promise: "A Page or Block can be included by reference and edited from every authorized rendering without creating synchronized copies"
kind: "primitive"
state: "approved_shape"
publicness: "public"
availability: "universal"
dependencies: ["content.object.reference"]
related_features: ["content.feature.living-references"]
roadmap_boundary: "feature"
acceptance_summary: "A complete proof demonstrates: Stable object/block identity; reference versus live-embed versus snapshot/fork modes; renderer inheritance; source/provenance affordance; access intersection; comment and version context; portable degradation."
proof_requirements: ["Stable object/block identity; reference versus live-embed versus snapshot/fork modes; renderer inheritance; source/provenance affordance; access intersection; comment and version context; portable degradation."]
evidence: []
superseded_by: null
last_reviewed: "2026-07-29"
---

# Synced Blocks and live embeds

## Contract

A Page or Block can be included by reference and edited from every authorized rendering without creating synchronized copies

## Acceptance boundary

A complete proof demonstrates: Stable object/block identity; reference versus live-embed versus snapshot/fork modes; renderer inheritance; source/provenance affordance; access intersection; comment and version context; portable degradation.

## Evidence boundary

Existing code may provide useful substrate, but this record is not verified until the complete atomic contract passes its proof requirements.

## Non-goals

This capability does not create a parallel datastore, permission model, or action surface.
