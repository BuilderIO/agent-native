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
works_today: "Suggestions ship in Content's document editor: people and agents can propose text changes, review them in place, and accept or reject them. Recent work preserves Suggesting-mode drafts, supports text inside tables and other nested blocks, groups rewritten phrases, refuses unplaceable accepts, and keeps comment AI suggestions in their thread (#6627, #6661, #6716, #6720, #6729, #7258, #7372)."
remains: "The generic typed review contract still needs complete Property, Block, and filtered-record coverage, durable disposition and conflict semantics, and end-to-end human/agent parity across the ordinary renderers."
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
last_reviewed: "2026-10-12"
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
