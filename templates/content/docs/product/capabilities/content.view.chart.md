---
record_type: "capability"
spec_version: 2
id: "content.view.chart"
name: "Chart View"
user_promise: "Chart turns authorized typed query results into understandable analytical visualizations that remain usable as saved Views, embedded Blocks, dashboards, and static output."
primary_user_job: "See a trustworthy pattern in typed records, inspect the contributing canonical rows, and reuse the same analysis wherever the work is discussed."
kind: "surface"
state: "approved_shape"
publicness: "public"
availability: "universal"
dependencies:
  ["content.view.grouping-aggregation", "content.view.renderer-conformance"]
related_features:
  [
    "content.feature.understand-what-your-data-says",
    "content.feature.build-living-dashboards",
  ]
roadmap_boundary: "feature"
acceptance_summary: "Chart uses a typed analytical specification over access-scoped query results, supports saved View, embedded Block, dashboard, and static-output presentations, and drills into the canonical records that produced each mark."
proof_requirements:
  [
    "Typed chart specification validation for dimensions, measures, grouping, aggregation, sort, missing values, and incompatible input",
    "Identical saved-View, embedded-Block, dashboard, and static-output behavior from one specification",
    "Access-safe marks, aggregates, drill-down, empty, stale, unavailable, and export-fallback behavior",
    "Real-interface interaction, keyboard, accessibility, responsive, and renderer-conformance workflows",
  ]
evidence: []
superseded_by: null
last_reviewed: "2026-07-29"
---

# Chart View

## Why this exists

Tables expose records; Charts make patterns in typed measures and groups easier to see. Chart View provides analytical visualization without creating a separate analytics datastore or a snapshot that loses its route back to the canonical records.

## Example workflow

A manager saves a Chart View that groups authorized work by status and measures item count over time. They embed the same typed chart as a Block in a weekly document and place it on a dashboard. Clicking a bar opens the access-scoped canonical rows that contributed to that mark. When the dashboard is exported or viewed where the interactive renderer is unavailable, the same specification provides a readable static fallback and accessible summary.

## Product contract

- A Chart is a typed analytical specification over an authorized Database or Query result: dimensions, measures, grouping, aggregation, sort, filters, display choices, and drill-down mapping are validated against typed input.
- One specification can render as a saved View, embedded Block, dashboard component, and static output. These are presentations of the same analysis, not separately maintained charts.
- A mark drills into the canonical records contributing to it through an access-scoped query. A chart never grants access to records that its viewer could not otherwise read.
- Aggregates, labels, totals, empty states, and exported summaries are computed only from authorized input. Hidden rows cannot leak through counts, bins, axes, or a drill-down result.
- Incompatible fields, invalid aggregation, no data, stale results, unavailable sources, and renderer failures remain distinct states with repair or retry guidance; none is rendered as a convincing zero.
- Chart supports analytical visuals such as bars, lines, areas, and other compatible presentations chosen by the specification. Compatibility, accessibility, and export fallback are provided through Typed Renderers.

## Boundaries and non-goals

- `content.view.grouping-aggregation` owns typed grouping and aggregate semantics; Chart owns their analytical visual presentation and mark-to-record interaction.
- `content.renderer.typed` and `content.view.renderer-conformance` own renderer compatibility, inheritance, accessibility, and output conformance; Chart does not define a new renderer registry.
- `content.view.graph` explores typed Relationships, while `content.view.canvas` arranges objects spatially. Mermaid is authored diagram source, not a Chart input or output model.
- Chart does not create a parallel business-intelligence warehouse, change query semantics, expose unauthorized data, or replace custom dashboard layout ownership.

## Acceptance stories

### Reuse one analysis across surfaces

Given a valid chart specification saved on an authorized Query, when a person opens it as a View, embeds it as a Block, and adds it to a dashboard, then each surface renders the same measure, grouping, filters, labels, and drill-down contract.

### Drill into only contributing records

Given a bar representing an aggregate over accessible and inaccessible source rows, when a viewer activates that bar, then the drill-down contains only accessible canonical records and the aggregate, axis, and accessible-text summary reveal no hidden contribution.

### Fail loudly rather than imply no work

Given a saved chart whose required field was removed or source is temporarily unavailable, when it renders, then it shows a typed invalid or unavailable state with repair or retry guidance rather than a zero-valued chart.

### Produce an accessible static presentation

Given a chart rendered in a noninteractive export context, when the interactive renderer is unavailable, then the output includes a compatible static representation and accessible textual summary derived from the same authorized specification.

## Current evidence

The catalog defines typed properties, views, grouping, aggregation, renderer conformance, and dashboards as related substrate. Current code may include isolated charts or visualization components, but no evidence proves the unified typed specification across all surfaces, safe drill-down, static fallback, or full failure contract. This Capability remains `approved_shape`.

## Proof plan

1. Validate specifications across compatible and incompatible fields, grouping, measures, aggregation, sorting, filtering, missing values, and schema changes.
2. Render one specification as a saved View, embedded Block, dashboard item, responsive surface, and static export; verify semantic and visual conformance.
3. Exercise mark drill-down, totals, labels, bins, empty data, access changes, stale data, deleted fields, source failure, renderer failure, and retry.
4. Verify access-first aggregates and drill-down under changing permissions, including export and agent-accessible output.
5. Complete mouse, keyboard, and assistive-technology interaction tests, including an accessible static fallback.

## Open questions

Supported chart families, formatting controls, sampling thresholds, and exact static-output formats remain open. They must fit the typed specification and preserve access-safe drill-down and truthful failure behavior.
