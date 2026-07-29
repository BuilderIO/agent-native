---
record_type: "capability"
id: "content.object.reference"
name: "References"
user_promise: "Stable Page/Database/Block references distinct from expressions"
kind: "primitive"
state: "approved_shape"
publicness: "public"
availability: "universal"
dependencies: ["content.object.page","content.object.block"]
related_features: ["content.feature.living-references"]
roadmap_boundary: "feature"
acceptance_summary: "A complete proof demonstrates: ID-based resolution, access, portable encoding, renderer inheritance."
proof_requirements: ["ID-based resolution, access, portable encoding, renderer inheritance."]
evidence: []
superseded_by: null
last_reviewed: "2026-07-29"
---

# References

## Contract

Stable Page/Database/Block references distinct from expressions

## Acceptance boundary

A complete proof demonstrates: ID-based resolution, access, portable encoding, renderer inheritance.

## Evidence boundary

Existing code may provide useful substrate, but this record is not verified until the complete atomic contract passes its proof requirements.

## Non-goals

This capability does not create a parallel datastore, permission model, or action surface.
