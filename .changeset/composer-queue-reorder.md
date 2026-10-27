---
"@agent-native/core": patch
"@agent-native/agentkit": patch
"@agent-native/toolkit": patch
---

Reorder queued messages and tidy the composer:

- Queued messages can be reordered: drag a row by its handle, press ArrowUp or ArrowDown on the handle (or Alt+ArrowUp/ArrowDown anywhere in the row), or pick Move up or Move down from the row menu. The move is announced, persisted through the new `reorderQueuedMessages` transport operation (`PUT /threads/:id/queue`, the `reorder` queue mutation in Agent-Native), and rolled back with a notice if the server refuses it. A reorder that names a different message set than the queue holds fails with `queue_order_stale` instead of reordering blind.
- The queue drawer keeps rows a fixed 32px with 14px/20px text, reserves its action columns so hovering and a second queued message never reflow a row, fades rows in instead of sliding them, and takes its corner radius from the composer so drawer and row corners are concentric.
- The composer placeholder reads "Reply…" once a thread has messages (`placeholder`, `replyPlaceholder` and `conversationStarted` props).
- ArrowUp in an empty composer edits the last sent message when the host passes `onRecallLastMessage`.
- Suggestion chips read as active controls with a hairline border and a hover fill, and the suggestion row grows to fit its caption on an opaque backing, so transcript text never shows through it.
- Reasoning renders as markdown.
- Attachment remove buttons have a 24px hit target.
- An empty slash menu says "No commands", or "No matches" for a query.
