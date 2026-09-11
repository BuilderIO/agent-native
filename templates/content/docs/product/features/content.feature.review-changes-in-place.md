---
record_type: "feature"
id: "content.feature.review-changes-in-place"
number: 7
name: "Review changes in place"
chapter: "content.chapter.consensus"
order: 7
roadmap_status: "partially_implemented"
summary: "Accept or reject proposed human and agent changes in the ordinary Content interface."
example_workflow: "An agent revises a live article and its metadata; the editor reviews the rendered Page, accepts the stronger passages, rejects an incorrect Property change, and leaves the remaining suggestions pending for another pass."
works_today: "Source change sets, Builder review machinery, audit records, and document snapshots prove several parts of the review loop and provide useful donor implementations."
remains: "Content needs one generic typed diff and suggestion system that reviews bodies, Properties, Blocks, and filtered record sets directly in their ordinary renderers."
required_capabilities:
  [
    "content.diff.in-place",
    "content.diff.filtered-review",
    "content.revision.suggestions",
    "content.event.committed",
    "content.history.queryable",
  ]
enhancing_capabilities: ["content.diff.ai-assist", "content.review.code"]
increments: []
feature_proof: null
publicness: "public"
last_reviewed: "2026-07-29"
---

# Feature 7: Review changes in place

Accept or reject proposed human and agent changes in the ordinary Content interface.

## Product contract

- **Suggestions:** Preserve a pending change set without mutating the canonical Page immediately.
- **Typed diffs:** Compare body content, Properties, Blocks, and structured values through their normal renderers.
- **Filtered review:** Review only the affected or relevant subset without losing dependent changes outside the current filter.
- **Selective acceptance:** Accept all, reject all, or choose individual compatible changes without seven ceremonial confirmation screens.
- **Stale changes:** Detect when the underlying material has moved and offer an honest rebase, refresh, or conflict state.
- **Agent-authored work:** Group an agent run into one inspectable Revision whose changes remain attributable and recoverable.
