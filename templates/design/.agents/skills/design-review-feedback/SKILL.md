---
name: design-review-feedback
description: >-
  Work through persisted, element-anchored review comments on shared Design
  prototypes and close the loop with verified edits.
---

# Design Review Feedback

Use the shared review actions for design feedback:

1. Call `view-screen` first so the active design, screen, and review queue are
   current. It reports `design.review.openThread`: the thread the user has
   open, `null` when none is, or `{ threadId, unavailable: true }` when it is
   open but cannot be read.
2. When the user says "this comment" or "this thread", work on
   `design.review.openThread`. Otherwise call `get-review-feedback` for the open
   queue and work on one root thread at a time. Keep the thread id, target
   screen id, anchor node id, and nearby context together while editing.
3. For element-anchored feedback, prefer the stable
   `data-agent-native-node-id` from the anchor. Use the stored percentage point
   only as a visual fallback when the node cannot be resolved.
4. Read the affected file with `get-design-snapshot`, make the smallest
   persisted edit with `edit-design` or the appropriate design action, then
   verify the saved result with `get-design-snapshot` and a screenshot or audit
   when the change is visual.
5. Resolve the thread with `resolve-review-thread` only after the edit is
   persisted and verified, and pass `resolutionNote` with a one-line description
   of the persisted change. If the user needs to decide something, reply with
   `reply-review-comment` and set `resolutionTarget: "human"`; do not silently
   resolve it.
6. After applying a thread, call `consume-review-feedback` for the applied
   agent-targeted root comment so the queue does not repeatedly resurface the
   same work.

Reviewers can leave a human-only comment or choose **Send to agent** when
composing. Editors can selectively route an existing open thread with
`send-review-thread-to-agent`; that action only changes the selected thread.
When a thread is sent from the Design UI, the agent chat handoff includes its
thread id and instructs the agent not to apply other queued feedback. A thread sent from the
card menu may instead say Suggest changes (propose edits only; do not edit),
Reply in thread (answer with `reply-review-comment` only; do not edit or
resolve), or Apply changes and resolve (apply, then resolve).

Use `create-review-comment` for agent-authored follow-up notes when a durable
record is more useful than a chat-only explanation. Keep review comments
scoped to the design resource and the target screen; never copy large HTML,
screenshots, or provider payloads into a comment.
