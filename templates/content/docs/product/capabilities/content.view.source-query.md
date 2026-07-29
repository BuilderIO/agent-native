---
record_type: "capability"
id: "content.view.source-query"
name: "Cross-source Queries"
user_promise: "One saved typed query composes local Databases and provider collections through unions, joins, filters, relations, and explicit field alignment, then renders through any compatible view"
kind: "surface"
state: "approved_shape"
publicness: "public"
availability: "universal"
dependencies: ["content.query.object","content.source.catalog"]
related_features: ["content.feature.connect-your-sources"]
roadmap_boundary: "feature"
acceptance_summary: "A complete proof demonstrates: Visual builder reuses source picker, filter/sort/group/expression controls, live preview, output-field alignment, and compatible renderers; preserve source/row/field identity and access before composition; query-local output schema; explicit write-through and create-target rules; source-qualified ambiguity; pagination/scale; migration from materialized multi-source Databases without data loss."
proof_requirements: ["Visual builder reuses source picker, filter/sort/group/expression controls, live preview, output-field alignment, and compatible renderers; preserve source/row/field identity and access before composition; query-local output schema; explicit write-through and create-target rules; source-qualified ambiguity; pagination/scale; migration from materialized multi-source Databases without data loss."]
evidence: []
superseded_by: null
last_reviewed: "2026-07-29"
---

# Cross-source Queries

## Contract

One saved typed query composes local Databases and provider collections through unions, joins, filters, relations, and explicit field alignment, then renders through any compatible view

## Acceptance boundary

A complete proof demonstrates: Visual builder reuses source picker, filter/sort/group/expression controls, live preview, output-field alignment, and compatible renderers; preserve source/row/field identity and access before composition; query-local output schema; explicit write-through and create-target rules; source-qualified ambiguity; pagination/scale; migration from materialized multi-source Databases without data loss.

## Evidence boundary

Existing code may provide useful substrate, but this record is not verified until the complete atomic contract passes its proof requirements.

## Non-goals

This capability does not create a parallel datastore, permission model, or action surface.
