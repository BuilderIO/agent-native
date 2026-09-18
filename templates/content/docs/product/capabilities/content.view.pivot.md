---
record_type: "capability"
spec_version: 2
id: "content.view.pivot"
name: "Pivot View"
user_promise: "Pivot places dimensions on rows and columns, typed aggregations in cells, and drills back to canonical records."
primary_user_job: "Compare an authorized measure across two meaningful dimensions and inspect the records behind any result."
kind: "surface"
state: "approved_shape"
publicness: "public"
availability: "universal"
dependencies: ["content.view.grouping-aggregation"]
related_features: ["content.feature.understand-what-your-data-says"]
roadmap_boundary: "feature"
acceptance_summary: "Pivot configures typed row and column dimensions with access-safe measures, totals, and drill-in to canonical contributing records."
proof_requirements:
  [
    "Typed dimensions, measure selection, totals, nulls, ordering, and configuration persistence",
    "Access-safe cells, totals, drill-in, export, agent context, and empty or unavailable input tests",
    "Real-interface keyboard table navigation, responsive overflow, reload, and dense-data workflow",
  ]
evidence: []
superseded_by: null
last_reviewed: "2026-07-29"
---

# Pivot View

## Why this exists

One flat group can answer “how much?”; a pivot makes the crossing of two questions
legible without detaching its cells from the records that made them.

## Example workflow

A lead puts project on rows, status on columns, and estimate sum in cells. Selecting a
cell opens its authorized contributing records rather than a copied spreadsheet range.

## Product contract

- Pivot is a saved View configuration over canonical, access-scoped Query results.
- Row and column dimensions and typed measures use grouping and aggregation semantics.
- Cells, totals, labels, drill-in, export, and agent context reveal only authorized input.
- Configuration persists independently of the canonical records and reports unavailable data honestly.

## Boundaries and non-goals

Grouping and aggregation own measure semantics. Pivot is not a formula grid, a writable
cell store, or a replacement for Chart.

## Acceptance stories

### Compare two dimensions

Given an authorized task result, when a viewer pivots project by status, then each cell
and total reflects only eligible records and preserves the selected typed measure.

### Inspect a cell

Given a visible cell, when the viewer drills in, then the resulting collection contains
only its authorized contributors and maintains canonical record identity.

## Current evidence

The grouping dependency establishes intended substrate; no repository evidence proves a
complete Pivot renderer. This Capability remains `approved_shape`.

## Proof plan

1. Test dimensions, measures, totals, nulls, ordering, persistence, and drill-in.
2. Verify disclosure closure across cells, totals, exports, and agents.
3. Exercise responsive table navigation, dense data, reload, and unavailable sources.

## Open questions

The initial dimension-depth limit and display policy for sparse matrices need design.
