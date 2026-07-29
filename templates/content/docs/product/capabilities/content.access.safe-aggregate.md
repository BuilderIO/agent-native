---
record_type: "capability"
id: "content.access.safe-aggregate"
name: "Access-safe computation"
user_promise: "Access applies before relation traversal, count, rollup, group, and aggregate"
kind: "primitive"
state: "exploring"
publicness: "public"
availability: "universal"
dependencies: ["content.access.page-database"]
related_features: ["content.feature.understand-what-your-data-says"]
roadmap_boundary: "feature"
acceptance_summary: "A complete proof demonstrates: Repair relation-count asymmetry; prove private records cannot leak through derived values."
proof_requirements: ["Repair relation-count asymmetry; prove private records cannot leak through derived values."]
evidence: []
superseded_by: null
last_reviewed: "2026-07-29"
---

# Access-safe computation

## Contract

Access applies before relation traversal, count, rollup, group, and aggregate

## Acceptance boundary

A complete proof demonstrates: Repair relation-count asymmetry; prove private records cannot leak through derived values.

## Evidence boundary

Existing code may provide useful substrate, but this record is not verified until the complete atomic contract passes its proof requirements.

## Non-goals

This capability does not create a parallel datastore, permission model, or action surface.
