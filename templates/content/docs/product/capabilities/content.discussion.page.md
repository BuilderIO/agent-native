---
record_type: "capability"
spec_version: 2
id: "content.discussion.page"
name: "Page Discussion"
user_promise: "Every Page has one continuing Discussion for humane, Page-wide collaboration and curated activity."
primary_user_job: "Discuss the larger meaning of work without losing the Page and revision context that gives the conversation sense."
kind: "primitive"
state: "approved_shape"
publicness: "public"
availability: "universal"
dependencies:
  [
    "content.object.page",
    "content.object.blocks-field",
    "content.event.committed",
  ]
related_features: ["content.feature.collaborate-in-context"]
roadmap_boundary: "feature"
acceptance_summary: "A lazily materialized canonical Page Discussion supports rich messages, bounded threads, reactions, Page-version cursors, selected Event/Comment activity, access, and notifications without replacing Comments or History."
proof_requirements:
  [
    "Canonical Page Discussion identity across current and future Versions",
    "Rich message, reply, mention, reaction, and bounded-thread behavior",
    "Revision/Event cursor and curated activity projection",
    "Access, notification, permalink, UI/Action, and concurrency coverage",
  ]
evidence: []
superseded_by: null
last_reviewed: "2026-07-29"
---

# Page Discussion

## Why this exists

Exact comments are not enough for the larger conversation: why the change matters, what was decided, and what should happen next. Discussion gives that conversation one durable home.

## Example workflow

A teammate starts a Page Discussion about an unclear strategy, replies in one focused sub-thread, links a relevant Comment thread, and later opens “view the Page then” to see the revision cursor that existed when the message was posted.

## Product contract

- Every Page has one canonical Discussion identity, created lazily on first use and authoritative across current and future Page Versions.
- Messages use Blocks fields; they may reply to or mention a message or actor, while one message opens at most one focused sub-conversation rather than infinite nesting.
- A message may connect to Comment threads without moving those Comments out of their Page-owned context.
- Each message records quiet Page Version and Revision/Event cursor context; UI reveals historical Page/diff on demand.
- Discussion curates selected collaboration Events and grouped Comment activity. History remains exhaustive; Comments remain exact anchors.

## Boundaries and non-goals

- Discussion is not another body Block, Database membership, task engine, or named Version.
- It does not replace Comments, Info, Annotations, Versions, or History; these are separate rails/modes.
- Curated activity does not duplicate Event authority or expose inaccessible details.

## Acceptance stories

### Continue one conversation across Versions

Given a Page has a Discussion and later receives a named Version, when a collaborator opens either Version, then the same Discussion is available with each message's appropriate Version cursor preserved.

### Keep a focused thread bounded

Given a Discussion message has replies, when a reply starts a sub-conversation, then subsequent replies remain understandable in that bounded thread and do not build an infinitely nested tree.

## Current evidence

Current Comments, mentions, notifications substrate, and document history provide adjacent pieces. A universal canonical Discussion, rich message grammar, cursors, and curated activity projection are not yet proven; this remains `approved_shape`.

## Proof plan

1. Create canonical Discussions, messages, replies, mentions, reactions, and Comment links across Page lifecycle operations.
2. Verify cursors, historical Page/diff links, selected Event grouping, and History separation.
3. Test access changes, notifications, permalinks, agents, external continuation boundaries, and deletion.
4. Exercise concurrent messages/reactions, reload, keyboard, and assistive technology.

## Open questions

Default grouping and activity-selection rules remain product refinement; they cannot make Discussion the recovery authority or create a second Page identity.
