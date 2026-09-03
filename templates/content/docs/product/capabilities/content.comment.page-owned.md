---
record_type: "capability"
spec_version: 2
id: "content.comment.page-owned"
name: "Comments"
user_promise: "Threaded Comments stay owned by a Page while targeting one or more precise Blocks."
primary_user_job: "Give exact feedback that remains intelligible after the document changes or appears elsewhere."
kind: "primitive"
state: "approved_shape"
publicness: "public"
availability: "universal"
dependencies: ["content.object.page", "content.object.blocks-field"]
related_features: ["content.feature.collaborate-in-context"]
roadmap_boundary: "feature"
acceptance_summary: "Comments preserve authoritative Page context, thread identity, rich body, precise historical Block anchors, access, and resolution across references, embeds, edits, and deletion."
proof_requirements:
  [
    "Page-owned thread and multi-Block anchor identity",
    "Anchor repair and historical target behavior after edits/deletion",
    "Access, mentions, replies, resolution, and notification behavior",
    "Shared Action/UI, embed/reference, concurrency, and recovery tests",
  ]
evidence: []
superseded_by: null
last_reviewed: "2026-07-29"
---

# Comments

## Why this exists

Feedback should remain attached to the sentence, image, or Block it concerns, even when the work is embedded in another place. Otherwise discussion becomes a trail of vague ghosts.

## Example workflow

A reviewer comments on two Blocks in a brief, replies with a Page reference, and resolves the thread after revision. Later the brief is embedded elsewhere; the comment still opens under the original Page context and its historical target.

## Product contract

- A Comment thread is owned by one Page and may target one or several Blocks or ranges in its Blocks fields.
- Rich Comment bodies use the shared Blocks-field grammar; replies and mentions retain the same Page authority.
- Anchors follow stable Block identity where possible and preserve historical target context after deletion rather than attaching to plausible new text.
- Resolve, reopen, edit, reply, and notification operations use shared Actions and record attributable change.
- References and embeds display the authoritative Page-owned thread; they do not clone or re-home it.

## Boundaries and non-goals

- Comments are exact-material feedback, not the Page-wide Discussion timeline.
- A comment does not create a Page, Database membership, or independent share policy.
- This capability does not define named Version access, although Comments retain Version context.

## Acceptance stories

### Preserve a deleted anchor

Given a Comment on a Block range, when the range and Block are deleted, then the Comment remains resolvable and opens authorized historical context instead of moving to a new nearby range.

### Keep one authoritative thread across an embed

Given a Page with a Comment thread is referenced or embedded elsewhere, when a viewer opens the thread from either occurrence, then they see the same Page-owned thread and access decision.

## Current evidence

`document_comments` schema and editor Comment UI/actions provide anchored threaded-comment substrate. Stable multi-Block anchors, rich universal fields, historical repair, and embed authority are not fully proven; this remains `approved_shape`.

## Proof plan

1. Create, reply, mention, resolve, reopen, edit, and delete Comments through UI and Actions.
2. Test anchors through Block editing, move, split, deletion, restore, and named-Version context.
3. Verify references, embeds, access changes, notifications, agents, and exports.
4. Exercise concurrent replies/resolution, reload, keyboard, and assistive technology.

## Open questions

Anchor matching heuristics may evolve, but they may never silently claim a new target is the old one.
