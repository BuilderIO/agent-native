---
record_type: "capability"
id: "content.knowledge.graph"
name: "Graph queries"
user_promise: "Graph navigation and query over typed links, mentions, relations, and authority edges"
kind: "primitive"
state: "exploring"
publicness: "public"
availability: "universal"
dependencies: ["content.relationship.edge","content.access.visibility-closure"]
related_features: ["content.feature.sketch-connections-keep-whats-true"]
roadmap_boundary: "feature"
acceptance_summary: "A complete proof demonstrates: Stable identity and edge vocabulary; access-scoped recursive traversal, paths, ranking, and pattern matching; graph/canvas renderers; separate observed usage from declared governance; no second canonical datastore."
proof_requirements: ["Stable identity and edge vocabulary; access-scoped recursive traversal, paths, ranking, and pattern matching; graph/canvas renderers; separate observed usage from declared governance; no second canonical datastore."]
evidence: []
superseded_by: null
last_reviewed: "2026-07-29"
---

# Graph queries

## Contract

Graph navigation and query over typed links, mentions, relations, and authority edges

## Acceptance boundary

A complete proof demonstrates: Stable identity and edge vocabulary; access-scoped recursive traversal, paths, ranking, and pattern matching; graph/canvas renderers; separate observed usage from declared governance; no second canonical datastore.

## Evidence boundary

Existing code may provide useful substrate, but this record is not verified until the complete atomic contract passes its proof requirements.

## Non-goals

This capability does not create a parallel datastore, permission model, or action surface.
