---
record_type: "capability"
id: "content.source.builder-codec"
name: "Builder round-trip codec"
user_promise: "Builder JSON blocks round-trip through one pure typed codec shared by repo-backed docs and CMS-backed databases"
kind: "primitive"
state: "approved_shape"
publicness: "public"
availability: "configured"
dependencies: ["content.portability.roundtrip","content.source.adapters"]
related_features: ["content.feature.trust-your-connected-sources"]
roadmap_boundary: "feature"
acceptance_summary: "A complete proof demonstrates: Known block mappings, raw unknown fallback, hashes/conflicts, structured body field, golden round trips; truth/write policy remains source-lane-specific."
proof_requirements: ["Known block mappings, raw unknown fallback, hashes/conflicts, structured body field, golden round trips; truth/write policy remains source-lane-specific."]
evidence: []
superseded_by: null
last_reviewed: "2026-07-29"
---

# Builder round-trip codec

## Contract

Builder JSON blocks round-trip through one pure typed codec shared by repo-backed docs and CMS-backed databases

## Acceptance boundary

A complete proof demonstrates: Known block mappings, raw unknown fallback, hashes/conflicts, structured body field, golden round trips; truth/write policy remains source-lane-specific.

## Evidence boundary

Existing code may provide useful substrate, but this record is not verified until the complete atomic contract passes its proof requirements.

## Non-goals

This capability does not create a parallel datastore, permission model, or action surface.
