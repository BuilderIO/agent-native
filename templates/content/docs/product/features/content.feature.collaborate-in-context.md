---
record_type: "feature"
id: "content.feature.collaborate-in-context"
number: 6
name: "Collaborate in context"
chapter: "content.chapter.consensus"
order: 6
roadmap_status: "partially_implemented"
summary: "Comments, Discussion, messages, notifications, and history stay anchored to the Page or Database being shaped."
example_workflow: "A teammate comments on an unclear paragraph, discusses the larger issue in the Page's Discussion, links the conversation to Slack, and returns later to see the Comment, replies, and resulting changes together."
works_today: "Content supports anchored Comment threads, replies, resolution, mentions, notifications substrate, and document history. These already keep precise feedback closer to the artifact than an external chat can."
remains: "Every Page and Database needs its universal Discussion, rich Blocks-field messages, stable permalinks, access-safe Slack continuation, and clearly attributable message revisions."
required_capabilities:
  [
    "content.discussion.page",
    "content.comment.page-owned",
    "content.object.blocks-field",
    "content.notification.source",
    "content.event.committed",
  ]
enhancing_capabilities: ["content.agent.presence", "content.feedback.signal"]
increments: ["decide-together"]
feature_proof: null
publicness: "public"
last_reviewed: "2026-07-29"
---

# Feature 6: Collaborate in context

Comments, Discussion, messages, notifications, and history stay anchored to the Page or Database being shaped.

## Product contract

- **Comments:** Attach precise feedback to text, Blocks, media, or other exact material and preserve the historical target if that material changes.
- **Discussion:** Gives every Page and Database one continuing channel for collaboration about the whole artifact.
- **Rich messages:** Use Blocks fields so messages and Comments can contain the same references, embeds, Expressions, and structured content as Pages.
- **Threads and replies:** Keep focused sub-conversations understandable without infinite nesting.
- **Permalinks:** Make every message and Comment addressable from Content, Slack, or another Page.
- **Notifications:** Route attention through durable, queryable records without inventing another inbox engine.
- **Attributable revisions:** Let message owners edit their work while preserving visible history instead of erasing what was said.

## Increment: Decide together

Polls and explicit outcome state deepen the same Discussion rather than creating a separate decision system.

**Status:** Planned

**Example workflow:** A team posts a Poll in the Database Discussion, allows each person to choose up to two priorities, closes voting on Friday, records the outcome, and links directly to that result from the resulting plan.

**What works today:** Comments, reactions, rich content, Database Views, and permission-aware collaboration provide pieces of the eventual interaction.

**What remains:** Poll messages, bounded multi-select, stable options, closing behavior, access-safe aggregates, featured Poll rendering, and superseding outcomes still need implementation.

- **Poll messages:** Use the shared rich-message grammar and remain linkable like any other Discussion item.
- **Single or bounded multi-select:** Lets the poll author decide whether responders may choose one answer or a fixed number.
- **Stable options:** Preserves the meaning of existing responses when wording or presentation changes.
- **Close and freeze:** Stops new responses at a deliberate boundary and keeps the resulting aggregate inspectable.
- **Access-safe totals:** Never leak inaccessible participants through counts or aggregates.
- **Outcome state:** Records the current conclusion and allows a later outcome to supersede it without manufacturing a Decision object.
