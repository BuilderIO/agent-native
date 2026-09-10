---
record_type: "capability"
spec_version: 2
id: "content.view.map"
name: "Map View"
user_promise: "Map renders typed locations with points, clustering, filtering, and record previews before adding richer geographic layers."
primary_user_job: "See authorized records in their meaningful places and open the underlying record without making map coordinates a second source of truth."
kind: "surface"
state: "approved_shape"
publicness: "public"
availability: "universal"
dependencies: ["content.property.location", "content.view.renderer-conformance"]
related_features: []
roadmap_boundary: "supporting"
acceptance_summary: "Map projects access-scoped canonical results with typed locations, filters, clustering, previews, and shared record actions."
proof_requirements:
  [
    "Typed location selection, invalid or absent location, viewport, filter, and cluster behavior",
    "Access-safe markers, counts, previews, search, export, and shared Action editing",
    "Real-interface keyboard, assistive alternative, provider-unavailable, and reload workflows",
  ]
evidence: []
superseded_by: null
last_reviewed: "2026-07-29"
---

# Map View

## Why this exists

Place can be the clearest way to find work, provided a pin remains a projection of a
typed location on a canonical record.

## Example workflow

A coordinator filters locations to an authorized region, selects a cluster, previews a
record, and opens it. Changing the record's location uses the ordinary shared Action;
the pin updates after the canonical change.

## Product contract

- Map consumes a canonical Database or Query result and a declared typed location field.
- Markers, clusters, viewport filters, previews, and counts are access-scoped.
- Selecting a pin opens or edits the canonical record through shared View Actions.
- Missing, invalid, stale, and provider-unavailable locations report honestly.

## Boundaries and non-goals

`content.property.location` owns location meaning. Map is not geocoding custody, route
planning, a geographic layer editor, or a second record store.

## Acceptance stories

### Explore only authorized places

Given a result containing private locations, when a viewer opens Map, then no marker,
cluster count, preview, or viewport query exposes those records.

### Edit a location through its record

Given an authorized marker, when an editor changes its typed location, then the shared
Action updates one canonical record and the Map refreshes without duplicate state.

## Current evidence

No current implementation evidence proves Map's location, access, interaction, and
recovery contract. This Capability remains `approved_shape`.

## Proof plan

1. Test typed locations, invalid values, filters, clusters, and canonical preview/open.
2. Verify access closure through markers, counts, viewport changes, exports, and agents.
3. Exercise keyboard alternatives, source/provider failure, reload, and dense geographic results.

## Open questions

The first provider boundary and offline geographic behavior remain implementation questions.
