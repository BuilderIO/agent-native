---
record_type: "capability"
id: "content.source.row-union"
name: "Materialized multi-source Databases"
user_promise: "One Database materializing rows from several source-owned collections with a Source tag and per-source column bindings"
kind: "primitive"
state: "superseded"
publicness: "public"
availability: "configured"
dependencies: ["content.source.adapters","content.object.database"]
related_features: []
roadmap_boundary: "superseded"
acceptance_summary: "A complete proof demonstrates: Current code and the June 25 brief prove source-scoped row identity/writes, source selection for new rows, a user-visible Source property, and per-source field bindings; retain as migration/donor evidence while evaluating saved source queries as the simpler composition model."
proof_requirements: ["Current code and the June 25 brief prove source-scoped row identity/writes, source selection for new rows, a user-visible Source property, and per-source field bindings; retain as migration/donor evidence while evaluating saved source queries as the simpler composition model."]
evidence: []
superseded_by: "content.view.source-query"
last_reviewed: "2026-07-29"
---

# Materialized multi-source Databases

## Contract

One Database materializing rows from several source-owned collections with a Source tag and per-source column bindings

## Acceptance boundary

A complete proof demonstrates: Current code and the June 25 brief prove source-scoped row identity/writes, source selection for new rows, a user-visible Source property, and per-source field bindings; retain as migration/donor evidence while evaluating saved source queries as the simpler composition model.

## Evidence boundary

Existing code may provide useful substrate, but this record is not verified until the complete atomic contract passes its proof requirements.

## Non-goals

This record no longer defines new product work. Continue through `content.view.source-query`.
