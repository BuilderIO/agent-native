---
record_type: "capability"
id: "content.view.pivot"
name: "Pivot View"
user_promise: "Pivot places dimensions on rows and columns, typed aggregations in cells, and drills back to canonical records."
kind: "surface"
state: "approved_shape"
publicness: "public"
availability: "universal"
dependencies: ["content.view.grouping-aggregation"]
related_features: ["content.feature.understand-what-your-data-says"]
roadmap_boundary: "feature"
acceptance_summary: "A complete proof demonstrates: Pivot places dimensions on rows and columns, typed aggregations in cells, and drills back to canonical records."
proof_requirements: ["Pivot places dimensions on rows and columns, typed aggregations in cells, and drills back to canonical records."]
evidence: []
superseded_by: null
last_reviewed: "2026-07-29"
---

# Pivot View

## Contract

Pivot places dimensions on rows and columns, typed aggregations in cells, and drills back to canonical records.

## Acceptance boundary

A complete proof demonstrates: Pivot places dimensions on rows and columns, typed aggregations in cells, and drills back to canonical records.

## Evidence boundary

Existing code may provide useful substrate, but this record is not verified until the complete atomic contract passes its proof requirements.

## Non-goals

This capability does not create a parallel datastore, permission model, or action surface.
