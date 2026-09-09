---
record_type: "capability"
spec_version: 2
id: "content.view.scale"
name: "Large Database performance"
user_promise: "Databases stay responsive and incrementally queryable well beyond a few hundred rows"
primary_user_job: "Find, change, and navigate a large authorized collection without waiting for every row to arrive or trusting an incomplete result as final."
kind: "surface"
state: "failing"
publicness: "public"
availability: "universal"
dependencies: ["content.view.query"]
related_features: ["content.feature.see-your-information-your-way"]
roadmap_boundary: "feature"
acceptance_summary: "Views use server-side typed queries, bounded windows and aggregates, indexes, explicit partial states, and measured interaction budgets for large authorized collections."
proof_requirements:
  [
    "Server-side filter, sort, pagination/window, index, cursor, and bounded-aggregate coverage",
    "Partial-result, mutation, refresh, access-change, and unavailable-source correctness tests",
    "Real-interface performance traces for representative large collections and renderer interactions",
  ]
evidence: []
superseded_by: null
last_reviewed: "2026-07-29"
---

# Large Database performance

## Why this exists

A View that feels quick only while its collection is small has not yet earned the word
View. Scale must preserve both responsiveness and truthful result boundaries.

## Example workflow

An editor filters a large Database, scrolls to another window, edits a visible record,
and refreshes after another editor changes the result. The interface identifies partial
loading and does not count unseen rows as if it had completed the query.

## Product contract

- Filtering, sorting, access evaluation, pagination, and aggregates execute against bounded typed results.
- Windows, cursors, counts, totals, and loading state state whether results are complete, partial, stale, or unavailable.
- Mutations reconcile with canonical results and do not silently retain a record that no longer matches.
- Performance work preserves renderer conformance, accessible navigation, and Action parity.

## Boundaries and non-goals

Query execution owns collection semantics. This Capability is not a client-side cache
excuse, a permission shortcut, or a promise of unbounded instant export.

## Acceptance stories

### Navigate a partial result honestly

Given a large authorized result, when a viewer opens and scrolls it, then they can
navigate incremental windows and distinguish loaded rows and totals from incomplete work.

### Reconcile a changing collection

Given a visible record changed to no longer match a filter, when the Action succeeds,
then the View removes or repositions it truthfully without stale duplicate rows.

## Current evidence

The prior record is `failing`; existing View code does not constitute measured server-side
query, budget, or real-interface proof. It remains `failing`.

## Proof plan

1. Benchmark indexed filters, sorts, cursors, windows, and bounded aggregates at representative sizes.
2. Test partial, stale, access-changing, unavailable, and mutation-reconciliation states.
3. Capture real UI traces for initial load, navigation, edit, refresh, and accessible keyboard use.

## Open questions

Target data sizes and interaction budgets need an agreed workload before a verified claim.
