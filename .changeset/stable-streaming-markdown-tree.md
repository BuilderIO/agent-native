---
"@agent-native/core": patch
---

Chat no longer flashes and yanks the scroll while an answer streams. Two causes,
both in how streamed markdown was rendered:

- The finished message was rendered as one whole-document ReactMarkdown while
  the streaming message was rendered as memoized per-block pieces. The instant
  streaming stopped, the element tree changed shape, so React unmounted the
  message and rebuilt it: code blocks re-highlighted, images refetched, and the
  height collapsed for a frame — the "jumps especially at the end" report. The
  block split now drives both phases, so nothing is rebuilt when a turn ends.
- The in-progress tail rendered through a different component than completed
  blocks. A trailing newline promotes the tail to a completed block and the next
  character pulls it back, so on every line break that paragraph's DOM was
  destroyed and recreated — the "div rapidly being inserted and removed as text
  streams" report. The tail now renders through the same component, so the
  promotion reuses the DOM.

The message list was keyed on a digest of every message's part structure, so
the whole transcript unmounted and remounted each time a tool call started or a
placeholder tool id was rewritten to its server id — a flash and a lost scroll
position in the middle of an answer. That key guarded assistant-ui's stale
tap-resource render errors, which the error boundary around the list already
catches, clears and retries. `assistant-ui-part-churn.spec.tsx` drives part
append, mutation, id rename and splice through both the repository-import and
the streaming-adapter paths and records that no such error occurs, so the key is
gone and the boundary remains.

The scroll-to-bottom button was a flex sibling of the scroll viewport, so it
took 28px from the viewport when it appeared and gave it back when it hid —
and whether it appears is derived from scroll position, so it could scroll the
content enough to hide itself, which showed it again. That loop is the scroll
oscillating while text streams. It is now overlaid rather than in flow.

A code block that lost its highlighted HTML (a re-highlight after its content
changed) was hidden until Shiki resolved, blanking code the user was reading.
Space is still reserved invisibly on first paint, but a block that has already
painted never hides again.

Using one split for both phases required the split to be faithful to a
whole-document parse, which it was not: lists continue across blank lines and
link-reference/footnote definitions resolve document-wide, so splitting on a
blank line rendered a spaced list as several one-item lists and a referenced
link as literal `[text]`. That was visible during streaming and was silently
corrected only when the stream ended. `splitMarkdownBlocks` now keeps lists
whole across blank lines and declines to split a document containing reference
definitions, keeps indented code blocks whole across blank lines, and detects
those definitions during the fence-aware scan rather than over the raw text —
a TypeScript index signature inside a fence reads exactly like `[id]: url`, and
matching it disabled splitting for the whole message. `markdown-block-split.spec.ts`
asserts split/whole render parity construct by construct.
