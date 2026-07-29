---
record_type: "capability"
id: "content.view.grouping-aggregation"
name: "Grouping and aggregation"
user_promise: "Views group across several dimensions and compute access-safe totals, subtotals, rollups, and measures."
kind: "primitive"
state: "approved_shape"
publicness: "public"
availability: "universal"
dependencies: ["content.view.query","content.access.safe-aggregate"]
related_features: ["content.feature.see-your-information-your-way","content.feature.plan-work-across-time","content.feature.understand-what-your-data-says"]
roadmap_boundary: "feature"
acceptance_summary: "A complete proof demonstrates: Views group across several dimensions and compute access-safe totals, subtotals, rollups, and measures."
proof_requirements: ["Views group across several dimensions and compute access-safe totals, subtotals, rollups, and measures."]
evidence: []
superseded_by: null
last_reviewed: "2026-07-29"
---

# Grouping and aggregation

## Contract

Views group across several dimensions and compute access-safe totals, subtotals, rollups, and measures.

## Acceptance boundary

A complete proof demonstrates: Views group across several dimensions and compute access-safe totals, subtotals, rollups, and measures.

## Evidence boundary

Existing code may provide useful substrate, but this record is not verified until the complete atomic contract passes its proof requirements.

## Non-goals

This capability does not create a parallel datastore, permission model, or action surface.
