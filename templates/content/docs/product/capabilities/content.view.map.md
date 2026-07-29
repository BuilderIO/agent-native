---
record_type: "capability"
id: "content.view.map"
name: "Map View"
user_promise: "Map renders typed locations with points, clustering, filtering, and record previews before adding richer geographic layers."
kind: "surface"
state: "approved_shape"
publicness: "public"
availability: "universal"
dependencies: ["content.property.location","content.view.renderer-conformance"]
related_features: []
roadmap_boundary: "supporting"
acceptance_summary: "A complete proof demonstrates: Map renders typed locations with points, clustering, filtering, and record previews before adding richer geographic layers."
proof_requirements: ["Map renders typed locations with points, clustering, filtering, and record previews before adding richer geographic layers."]
evidence: []
superseded_by: null
last_reviewed: "2026-07-29"
---

# Map View

## Contract

Map renders typed locations with points, clustering, filtering, and record previews before adding richer geographic layers.

## Acceptance boundary

A complete proof demonstrates: Map renders typed locations with points, clustering, filtering, and record previews before adding richer geographic layers.

## Evidence boundary

Existing code may provide useful substrate, but this record is not verified until the complete atomic contract passes its proof requirements.

## Non-goals

This capability does not create a parallel datastore, permission model, or action surface.
