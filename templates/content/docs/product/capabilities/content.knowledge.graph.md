---
record_type: "capability"
spec_version: 2
id: "content.knowledge.graph"
name: "Graph queries"
user_promise: "Graph navigation and query over typed links, mentions, relations, and authority edges"
primary_user_job: "Traverse a meaningful authorized network without confusing observed connection with declared governance."
kind: "primitive"
state: "exploring"
publicness: "public"
availability: "universal"
dependencies: ["content.relationship.edge", "content.access.visibility-closure"]
related_features: ["content.feature.sketch-connections-keep-whats-true"]
roadmap_boundary: "feature"
acceptance_summary: "Graph queries use stable object and typed-edge vocabulary for access-scoped traversal, paths, ranking, and pattern matching."
proof_requirements:
  [
    "Typed contract, authorization, validation, Event/history, and recovery coverage",
    "Cross-surface UI, Action, agent-context, reload, and failure-state coverage",
    "Real-interface keyboard and assistive-technology workflow coverage",
  ]
evidence: []
superseded_by: null
last_reviewed: "2026-07-29"
---

# Graph queries

## Why this exists

Citation, governance, mention, and observed use carry different meanings that must remain distinct even when people explore them together.

## Example workflow

A researcher starts at a source Page, follows `cites` and `supports` edges, filters the path to a decision, and opens the same canonical objects in Graph and Canvas.

## Product contract

Graph queries use stable object and typed-edge vocabulary for access-scoped traversal, paths, ranking, and pattern matching. They distinguish observed usage from declared governance and feed renderers without a second canonical datastore.

## Boundaries and non-goals

Relationships own edge truth and visibility closure owns disclosure. This is not a graph database replacement, automatic authority inference, or a renderer-specific relation store.

## Acceptance stories

### Traverse without exposing a private bridge

Given a traversal with an inaccessible intermediate node, when a viewer asks for a path, then no endpoint, degree, path length, or ranking leaks that node.

### Keep observed use distinct from authority

Given a declared governance edge and an observed usage edge, when they are queried together, then Content labels their distinct semantics rather than treating usage as authority.

## Current evidence

This remains `exploring`; no complete recursive query, ranking, access-closure, and renderer proof is recorded.

## Proof plan

1. Test typed traversal, paths, patterns, ranks, cycles, and stable-object resolution.
2. Verify closure through expansions, counts, exports, Graph, Canvas, and agents.
3. Exercise inaccessible bridges, unavailable edges, stale indexes, and path inspection.

## Open questions

The initial graph query grammar and ranking semantics remain exploratory.
