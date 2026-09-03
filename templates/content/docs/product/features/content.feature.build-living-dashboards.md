---
record_type: "feature"
id: "content.feature.build-living-dashboards"
number: 23
name: "Build living dashboards"
chapter: "content.chapter.working-systems"
order: 23
roadmap_status: "planned"
summary: "Compose responsive Views, Charts, expressions, controls, and prose into durable operating surfaces."
example_workflow: "A go-to-market lead assembles a responsive Page with pipeline Charts, filtered account Views, explanatory prose, and personal controls so people and agents can inspect the same operating picture and discuss it in context."
works_today: "Pages can already combine prose, Blocks, references, expressions, and embedded Database Views, while saved Views provide reusable filtered presentations."
remains: "Responsive Page columns, resizable View and Chart Blocks, dashboard controls, chart conformance, personal interaction state, presentation behavior, and export fidelity still need implementation."
required_capabilities:
  ["content.layout.responsive", "content.view.chart", "content.embed.surface"]
enhancing_capabilities:
  ["content.presentation.mode", "content.expression.language"]
increments: []
feature_proof: null
publicness: "public"
last_reviewed: "2026-07-29"
---

# Feature 23: Build living dashboards

Compose responsive Views, Charts, expressions, controls, and prose into durable operating surfaces.

## Product contract

- **Ordinary Pages:** Serve as the dashboard canvas without introducing a separate dashboard datastore.
- **Embedded Views and Charts:** Reference saved configurations while allowing each occurrence to override size and presentation.
- **Responsive columns:** Arrange, resize, and reorder Blocks with a layout that linearizes coherently on smaller screens and in exports.
- **Controls and Expressions:** Let viewers change authorized filters or inputs without mutating the shared default accidentally.
- **Live context:** Keeps prose, decisions, metrics, and the underlying records together for people and agents.
- **Presentation mode:** Reuses shared Slides primitives to present Pages or ordered records without inventing slide-only content.
