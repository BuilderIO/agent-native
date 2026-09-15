---
record_type: "capability"
spec_version: 2
id: "content.view.grouping-aggregation"
name: "Grouping and aggregation"
user_promise: "Views group across several dimensions and compute access-safe totals, subtotals, rollups, and measures."
primary_user_job: "Understand meaningful totals and their contributing records without learning information I cannot access."
kind: "primitive"
state: "approved_shape"
publicness: "public"
availability: "universal"
dependencies: ["content.view.query", "content.access.safe-aggregate"]
related_features:
  [
    "content.feature.see-your-information-your-way",
    "content.feature.plan-work-across-time",
    "content.feature.understand-what-your-data-says",
  ]
roadmap_boundary: "feature"
acceptance_summary: "Authorized View results can be grouped by typed dimensions and measured with access-safe totals, subtotals, rollups, and drill-in."
proof_requirements:
  [
    "Typed multi-dimension grouping, ordering, empty groups, and measure semantics",
    "Access-before-grouping, totals, rollups, drill-in, export, and agent-context tests",
    "Real-interface refresh, unavailable-source, dense-result, and accessible-table workflows",
  ]
evidence: []
superseded_by: null
last_reviewed: "2026-07-29"
---

# Grouping and aggregation

## Why this exists

People need a useful shape for many records, but a subtotal must never reveal a row,
field, or inference that its viewer may not know.

## Example workflow

A lead groups authorized work by project and status, reads each subtotal, and opens a
group to inspect its canonical records. A private task contributes nowhere: not to a
count, a sum, an empty-group hint, or an export.

## Product contract

- Views group their canonical Query result by typed dimensions and compute declared measures.
- Access applies before grouping, aggregation, rollup, count, labels, drill-in, export, or agent context.
- Groups retain stable query semantics; sorting, collapse, and presentation do not mutate records.
- Empty, stale, unavailable, and partially loaded inputs are explicitly represented.

## Boundaries and non-goals

Queries own result semantics and safe aggregates own disclosure rules. This is not a
spreadsheet engine, a new analytics datastore, or permission-derived guessing.

## Acceptance stories

### Read an authorized subtotal

Given a grouped View with private rows, when a viewer opens it, then every group and
total is computed only from authorized rows and fields.

### Drill into a measure

Given a visible aggregate cell, when a viewer drills in, then Content opens the exact
authorized contributing records rather than an inferred or copied collection.

## Current evidence

Existing filters and renderer utilities are donor substrate. The repository does not
yet prove multi-dimensional measure semantics or disclosure closure, so this remains
`approved_shape`.

## Proof plan

1. Test typed grouping, measures, ordering, nulls, empty groups, and rollups.
2. Test access changes through results, counts, drill-in, exports, and agent context.
3. Exercise reload, source failure, pagination, dense views, keyboard, and assistive technology.

## Open questions

The initial measure catalog and treatment of mixed-source precision need implementation design.
