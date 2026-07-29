---
record_type: "capability"
id: "content.view.scale"
name: "Large Database performance"
user_promise: "Databases stay responsive and incrementally queryable well beyond a few hundred rows"
kind: "surface"
state: "failing"
publicness: "public"
availability: "universal"
dependencies: ["content.view.query"]
related_features: ["content.feature.see-your-information-your-way"]
roadmap_boundary: "feature"
acceptance_summary: "A complete proof demonstrates: Server-side typed queries, pagination/windowing, indexes, bounded aggregates, performance budgets and real UI traces."
proof_requirements: ["Server-side typed queries, pagination/windowing, indexes, bounded aggregates, performance budgets and real UI traces."]
evidence: []
superseded_by: null
last_reviewed: "2026-07-29"
---

# Large Database performance

## Contract

Databases stay responsive and incrementally queryable well beyond a few hundred rows

## Acceptance boundary

A complete proof demonstrates: Server-side typed queries, pagination/windowing, indexes, bounded aggregates, performance budgets and real UI traces.

## Evidence boundary

Existing code may provide useful substrate, but this record is not verified until the complete atomic contract passes its proof requirements.

## Non-goals

This capability does not create a parallel datastore, permission model, or action surface.
