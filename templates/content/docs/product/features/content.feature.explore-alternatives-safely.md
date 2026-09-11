---
record_type: "feature"
id: "content.feature.explore-alternatives-safely"
number: 8
name: "Explore alternatives safely"
chapter: "content.chapter.consensus"
order: 8
roadmap_status: "planned"
summary: "Create named Versions, compare them, selectively merge them, and promote one without losing the others."
example_workflow: "A team keeps the published article canonical while creating a private rewrite, compares the two Versions in the normal editor, selectively merges the best changes, and promotes the rewrite only when it is ready."
works_today: "Content preserves whole-document snapshots and can restore earlier revisions, while the broader event and diff architecture establishes the lower-level history foundation."
remains: "Named Page Versions, Version-specific access, in-place comparison, selective merge, canonical promotion, and Version-aware collaboration are still planned."
required_capabilities:
  [
    "content.version.branching",
    "content.version.field-history",
    "content.diff.in-place",
    "content.access.row-private",
  ]
enhancing_capabilities:
  ["content.diff.filtered-review", "content.research.annotation"]
increments: []
feature_proof: null
publicness: "public"
last_reviewed: "2026-07-29"
---

# Feature 8: Explore alternatives safely

Create named Versions, compare them, selectively merge them, and promote one without losing the others.

## Product contract

- **One stable Page:** Keeps identity, title, top-level Properties, sharing, and Discussion common across its Versions.
- **Named Versions:** Hold deliberate alternative bodies such as a published article and a new working draft.
- **Version-specific access:** Allows a Version to be more private than its Page, but never more broadly shared.
- **Compare and merge:** Shows differences in the ordinary Page interface and supports selective acceptance in either direction.
- **Canonical promotion:** Makes any authorized Version current without destroying the Version it replaces.
- **Version context:** Quietly anchors Comments, Discussion messages, Annotations, and execution receipts to the Version being viewed.
