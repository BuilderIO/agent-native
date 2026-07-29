---
record_type: "capability"
id: "content.template.update"
name: "Template updates"
user_promise: "Never-auto update notice, structural diff, selective apply/reset"
kind: "primitive"
state: "approved_shape"
publicness: "public"
availability: "universal"
dependencies: ["content.template.graph","content.diff.in-place"]
related_features: ["content.feature.evolve-systems-safely"]
roadmap_boundary: "feature"
acceptance_summary: "A complete proof demonstrates: Typed diff/events, provenance, local-addition preservation, dependency-safe partial apply."
proof_requirements: ["Typed diff/events, provenance, local-addition preservation, dependency-safe partial apply."]
evidence: []
superseded_by: null
last_reviewed: "2026-07-29"
---

# Template updates

## Contract

Never-auto update notice, structural diff, selective apply/reset

## Acceptance boundary

A complete proof demonstrates: Typed diff/events, provenance, local-addition preservation, dependency-safe partial apply.

## Evidence boundary

Existing code may provide useful substrate, but this record is not verified until the complete atomic contract passes its proof requirements.

## Non-goals

This capability does not create a parallel datastore, permission model, or action surface.
