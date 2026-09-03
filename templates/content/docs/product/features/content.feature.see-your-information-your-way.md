---
record_type: "feature"
id: "content.feature.see-your-information-your-way"
number: 5
name: "See your information your way"
chapter: "content.chapter.durable-home"
order: 5
roadmap_status: "in_validation"
summary: "Move among compatible Database and Query Views without changing the records underneath."
example_workflow: "A marketing team edits its editorial Database as a Table, plans work on a Board and Calendar, then gives executives a compact List of the same canonical articles."
works_today: "Table, List, Board, Gallery, Calendar, Timeline, and Form renderers already exist, along with shared filters, sorts, grouping, calculations, and visible-field controls."
remains: "Every renderer needs the same proven permissions, Actions, agent context, accessibility, persistence, performance, keyboard behavior, and recovery. Incomplete Views should remain gated until they pass that contract."
required_capabilities:
  [
    "content.renderer.typed",
    "content.view.query",
    "content.view.renderer-conformance",
    "content.view.scale",
  ]
enhancing_capabilities:
  [
    "content.view.fast-capture",
    "content.view.grouping-aggregation",
    "content.view.timeline",
  ]
increments: []
feature_proof: null
publicness: "public"
last_reviewed: "2026-07-29"
---

# Feature 5: See your information your way

Move among compatible Database and Query Views without changing the records underneath.

## Product contract

- **Table and List:** Support fast scanning, keyboard navigation, inline editing, and flexible visible fields.
- **Board and Gallery:** Arrange records by workflow state or visual identity while preserving canonical records.
- **Calendar and Timeline:** Place records across dates and ranges through the same typed time Properties.
- **Form:** Collect new records through a saved presentation of the Database's schema and validation.
- **View controls:** Filter, sort, group, format, and conditionally style each presentation.
- **Density:** Adjust compact, cozy, or comfortable spacing and secondary information without creating another View type.
- **Renderer conformance:** Gives every View the same permissions, Actions, agent context, accessibility, persistence, and recovery contract.
