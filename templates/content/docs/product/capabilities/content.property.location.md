---
record_type: "capability"
spec_version: 2
id: "content.property.location"
name: "Typed locations"
user_promise: "Store a place or coordinates as a meaningful location that maps, queries, sources, and export can understand."
primary_user_job: "Capture a place at known precision for portable use."
kind: "primitive"
state: "approved_shape"
publicness: "public"
availability: "universal"
dependencies: ["content.property.typed"]
related_features: []
roadmap_boundary: "supporting"
acceptance_summary: "Location Properties preserve a typed structured place and coordinates with clear precision, display, query, source mapping, and portable export behavior."
proof_requirements:
  [
    "A location is typed structured data, not a display string or map pin owned by one renderer.",
    "Authors can keep a human place, coordinates, and known precision without fabricating missing geocoding data.",
    "Maps and sources are projections/adapters; access, queries, and export use the canonical value and disclose unsupported fields honestly.",
  ]
evidence: []
superseded_by: null
last_reviewed: "2026-07-29"
---

# Typed locations

## Why this exists

A place has more meaning than an address string, but false precision is actively misleading. Authors need to preserve what they know about a location while letting maps and exports consume it without inventing details.

## Example workflow

Nia records a field visit with label, coordinates, and approximate precision; map and nearby query use it while export retains known data.

## Product contract

- A location is typed structured data, not a display string or map pin owned by one renderer.
- Authors can keep a human place, coordinates, and known precision without fabricating missing geocoding data.
- Maps and sources are projections/adapters; access, queries, and export use the canonical value and disclose unsupported fields honestly.

## Boundaries and non-goals

- Typed Properties own the value contract; map Views and provider adapters consume or map locations without becoming the source of truth.
- Locations do not imply geocoding, tracking, hidden precision, or an automatic map-provider dependency.

## Acceptance stories

### Do not invent precision

Given a source only provides a city, when Content imports it, then Content keeps city/precision without fabricating coordinates.

### Maps are projections

Given a renderer fails, when a person opens the Location Property, then the location remains queryable and exportable.

## Current evidence

`app/components/editor/DocumentProperties.tsx` maps location to `place`; `shared/properties.ts` includes `place`, but no structured location schema exists.

## Proof plan

1. Author labels/coordinates/precision and serialize them.
2. Query/render in map and non-map surfaces.
3. Import partial provider values without invented geocoding.
4. Export/import with access-aware coordinates.

## Open questions

Points versus polygons/routes is open.
