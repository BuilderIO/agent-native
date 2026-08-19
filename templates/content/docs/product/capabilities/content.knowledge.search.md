---
record_type: "capability"
spec_version: 2
id: "content.knowledge.search"
name: "Search"
user_promise: "Fast access-aware search across titles, bodies, rows, sources, and later comments/review"
primary_user_job: "Find the most useful authorized evidence quickly and understand where it came from and how fresh it is."
kind: "primitive"
state: "in_progress"
publicness: "public"
availability: "universal"
dependencies: ["content.access.visibility-closure"]
related_features: ["content.feature.durable-foundations"]
roadmap_boundary: "feature"
acceptance_summary: "Search performs indexed lexical retrieval first across eligible objects, returns access-scoped snippets and highlights with source and freshness, and shares ranking semantics between people and agents.."
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

# Search

## Why this exists

Search is how a system remembers aloud. It must be quick without ever pronouncing information a viewer may not read.

## Example workflow

A contributor searches a phrase, opens an indexed Page snippet, filters to a connected Source, and sees that one result is stale rather than treating it as current.

## Product contract

Search performs indexed lexical retrieval first across eligible objects, returns access-scoped snippets and highlights with source and freshness, and shares ranking semantics between people and agents.

## Boundaries and non-goals

Visibility closure owns authorization. This is not semantic-answer generation, a source-truth override, or a leakage-prone global index.

## Acceptance stories

### Suppress a private matching title

Given a private matching Page, when a viewer searches its title and body, then no result, highlight, count, or ranking inference exposes it.

### Label a stale connected result

Given a stale connected Source result, when it appears, then its freshness state is visible and opening it follows the Source policy.

## Current evidence

Existing search paths are in progress donor substrate, but complete indexed, freshness, ranking, and agent-parity proof is incomplete. This Capability remains `in_progress`.

## Proof plan

1. Index titles, bodies, rows, and Sources; test lexical queries, snippets, highlights, and pages.
2. Verify private-match suppression, human/agent ranking, freshness, provenance, and opening.
3. Exercise stale indexes, source refresh, reload, keyboard traversal, and result summaries.

## Open questions

The first ranking signals beyond lexical relevance need design.
