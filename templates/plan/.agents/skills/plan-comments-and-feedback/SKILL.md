---
name: plan-comments-and-feedback
description: >-
  Plan review threads end to end: what `get-plan-feedback` returns, how to read
  anchors, resolver intent, replies, notification email, deletion, and abuse
  reports. Use when reading, answering, resolving, or removing plan feedback.
---

# Plan Comments and Feedback

- Plan comments include reviewer identity, @mentions, resolver intent
  (`agent` or `human`), exact anchors, and design-review threads. When adding
  human feedback through `update-visual-plan`, preserve `authorEmail` and
  `authorName` when known; pass `parentCommentId` to reply inline to an
  existing comment thread. Text feedback should anchor to the nearest prose
  block, and visual/canvas feedback should include target coordinates plus
  concise surrounding context.
- Use `delete-plan-comment` only when the user explicitly asks to remove a
  comment, undo an accidental comment, or clean up an obsolete thread. Deleting
  is a soft delete: normal comment views hide the comment while the database row
  remains for audit/debugging. Deleting a thread root also deletes its replies.
  When feedback has merely been handled, prefer `resolve-plan-comment` and
  `consume-plan-feedback` so review history remains visible.
- Use `delete-visual-plan` only when the owner explicitly asks to delete or
  restore their hosted plan/recap data. `mode=soft` moves the resource to the
  Deleted tab and makes normal reads/direct links stop working; `mode=restore`
  undeletes it; `mode=hard` permanently removes the plan row plus plan-scoped
  comments, sections, events, versions, shares, reports, SQL asset records, and
  collab snapshots. Hard delete requires the exact confirmation phrase
  `DELETE <planId>`.
- `get-plan-feedback` returns flat comments, grouped threads, anchor summaries,
  detailed anchor lines, and recent review events that describe the edit/comment
  delta. Use those fields before changing code or updating the plan, especially
  to distinguish comments the agent should act on from comments intended for a
  human reviewer.
- **Anchor interpretation.** `targetX`/`targetY` are percentages within the
  named element; bare `x`/`y` are percentages of the whole document;
  `canvasX`/`canvasY` are board-world pixels. Wireframe anchors carry
  `targetNodeId`/`targetNodePath` — prefer those over raw coordinates; fall back
  to coordinates plus the focused screenshot only when no node id is present.
  Resolve `textQuote` with `contextBefore`/`contextAfter`; if `ambiguous: true`,
  ask the user. Threads in `detachedThreads` no longer match current prose —
  reconcile, never drop. Act on `resolutionTarget=agent`; treat `human` as
  context only; `@mentions` are notification signals, not routing. Mark ingested
  comments consumed (`consumedCommentIds`); set `status=resolved` only on
  agent-targeted comments you actually addressed. When a plan write addresses
  feedback, do not resolve or consume it until a post-write `get-visual-plan`
  confirms the requested change persisted. Then do both: call
  `resolve-plan-comment` for the addressed thread and `consume-plan-feedback`
  for its comments.
- New human comments send best-effort transactional email when email is
  configured: root comments and replies notify the plan owner, @mentioned
  members, and replies also notify prior human participants in that thread.
  Reuse the shared `renderEmail` template; do not invent a separate
  plan-specific email style.
- `report-visual-plan` records a bounded abuse report for a public plan or recap
  without changing plan content. It requires the caller to be scoped to an
  accessible public plan, accepts a fixed reason plus optional short details,
  and updates an existing open report from the same reporter instead of creating
  duplicate rows.

## Related Skills

- **plan-hosted-writes** — verify a write persisted before resolving or
  consuming the feedback it addressed.
- **plan-browser-editing** — the editing surfaces reviewers annotate.
- **plan-source-sync** — `comments.json` sidecars for DB-free local plans.
- **plan-events** — automating notifications on `plan.commented`.
