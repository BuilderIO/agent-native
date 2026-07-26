---
"@agent-native/core": patch
---

Bound runaway agent turns by repetition rather than by volume, so genuinely deep
analyses are no longer cut off.

The turn budgets introduced alongside the terminal iteration cap were sized as
work limits rather than runaway backstops, which would have stopped legitimate
long-running work: production contains a real 117-tool-call analysis that a
100-iteration cap would have truncated, and a multi-source investigation can
legitimately exceed both a 20-minute wall clock and a 3M-token ceiling.

Volume does not distinguish a spiral from depth. Repetition does — the observed
runaway turns issued 39 identical `run-code` webFetches and 43 identical
`docs-search` calls, while the expensive-but-healthy turns kept making _new_
calls. So the ceilings move up to backstop levels (400 iterations, 20M input
tokens, 90 minutes) and a new per-turn guard stops a turn once the same tool has
been called with identical arguments `MAX_IDENTICAL_TOOL_CALLS` (8) times,
counted before any journal or cache short-circuit — serving a repeat from cache
still means the model is asking the same question again.
