---
record_type: "feature"
id: "content.feature.understand-what-your-data-says"
number: 22
name: "Understand what your data says"
chapter: "content.chapter.working-systems"
order: 22
roadmap_status: "partially_implemented"
summary: "Use Charts, Pivots, grouping, measures, and drill-down without creating a separate analytics datastore."
example_workflow: "A marketing analyst groups campaigns by channel, compares spend and conversions in a Chart and Pivot, then drills into one surprising aggregate to inspect the canonical campaigns behind it."
works_today: "Database calculations, grouping, rollup foundations, and chart tooling elsewhere in the Agent Native framework provide useful implementation donors."
remains: "Content needs typed aggregations, multi-dimensional grouping, Pivot, a shared Chart specification and renderer library, saved Chart Views, embeddable Chart Blocks, and drill-down to canonical records."
required_capabilities:
  [
    "content.view.grouping-aggregation",
    "content.view.pivot",
    "content.view.chart",
    "content.access.safe-aggregate",
  ]
enhancing_capabilities: ["content.renderer.typed", "content.view.query"]
increments: []
feature_proof: null
publicness: "public"
last_reviewed: "2026-07-29"
---

# Feature 22: Understand what your data says

Use Charts, Pivots, grouping, measures, and drill-down without creating a separate analytics datastore.

## Product contract

- **Multiple grouping dimensions:** Partitions typed Query results consistently across Views.
- **Measures and totals:** Compute access-safe counts, sums, averages, subtotals, and grand totals.
- **Charts:** Share one typed chart specification and renderer toolkit with Agent Native Analytics.
- **Pivot:** Places dimensions on rows and columns with typed aggregations in cells.
- **Drill-down:** Opens the canonical records behind an aggregate instead of turning cells into independent data.
- **Accessible summaries:** Explains the chart or pivot meaning beyond color, shape, or pointer interaction.
- **Static fidelity:** Preserves useful output in public Pages, presentations, and exports.
