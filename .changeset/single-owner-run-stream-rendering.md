---
"@agent-native/core": patch
---

Chat no longer renders the same assistant turn twice — the long-standing report
of a final message streaming in two places at once and tool outputs appearing
more than once. Four independent causes, all of which let one run be folded into
UI state more than once:

- SSE resume cursors were kept in a single browser-wide slot, and
  `updateActiveRunSeq` took no run identity, so it wrote the caller's sequence
  into whichever run happened to occupy the slot. With chats streaming in
  parallel (agent teams, multiple tabs) runs evicted each other, and
  `resolveReconnectAfterSeq` then returned 0 — replaying an entire run on top of
  history that already contained it. Cursors are now stored per `{threadId,
  runId}`, identity is required to advance one, and a cursor outlives its run
  losing focus so a later reconnect resumes instead of replaying.
- The adapter's stream and the reconnect reader could both fold one run at once.
  Ownership was a React ref re-checked by a 1s poll that is skipped while the tab
  is hidden, and the refs were per-component-instance while several chat
  instances mount against one run. Ownership now lives in a module-scoped
  registry claimed and checked synchronously, and the adapter preempts the
  reconnect fallback when it takes over.
- The reconnect overlay was deliberately kept mounted beside the live message
  list for up to 2500ms after handoff, leaving two independent folds of the same
  turn on screen with only content-similarity heuristics hiding the second. The
  overlay now renders only while no runtime owns the turn.
- The server fold pushed a tool card for every `tool_start`, including the
  replays that journal and zombie-ledger recovery emit for calls that already
  ran. The live client coalesced those onto the original card, so a duplicate
  tool output appeared only after a reload. A replayed `tool_start` now folds
  onto its existing card.
