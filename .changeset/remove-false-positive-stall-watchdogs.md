---
"@agent-native/core": patch
---

Remove the in-loop no-progress watchdogs, which were failing healthy runs far more often than they caught wedged ones.

Two 90s bounds ran for the whole model stream — one on silence between engine frames (`MODEL_STREAM_NO_PROGRESS_TIMEOUT_MS`), one on a tool input whose byte count stopped growing (`ACTION_PREPARATION_NO_PROGRESS_TIMEOUT_MS`) — plus a zero-byte tool-input restart tripwire. Each inferred a dead stream from the absence of a particular event, and that inference cannot be made on the Anthropic transport: the SDK drops the provider's `ping` keepalives before any consumer sees them (`core/streaming.js`: `if (sse.event === 'ping') continue;`, with no opt-out), so a model composing a large tool argument is indistinguishable from a wedged socket.

That is normal operation, not an edge case. Only a tool declared for eager input streaming emits anything at all while its arguments are generated, so a long file write or a long structured result is a content-silent window whose length is set by the size of the argument. In one production deployment, 2 of 27 one-shot analyst runs completed; the guards added for reliability were the thing taking it away.

- `ACTION_PREPARATION_NO_PROGRESS_TIMEOUT_MS` and its deadline are gone, including the `earliestStartedAt` fallback that anchored the bound to a start time it never advanced past, and the `Math.min` that let it override a demonstrably live stream.
- `MODEL_STREAM_NO_PROGRESS_TIMEOUT_MS` and its deadline are gone.
- The zero-byte restart tripwire is gone (`ACTION_PREPARATION_ZERO_BYTE_RESTART_LIMIT`, `noteZeroByteToolInputStart`, `resetZeroByteToolInputRestart`).
- The two run-lifecycle invariants asserting an ordering between those bounds and the run-manager backstop are gone with them.

One in-loop bound survives: the pre-first-frame cap on the clamped hosted foreground runtime, where the ~57s platform wall arrives before the engine's own 120s abort could. The first real frame releases it, so long first tokens, long thinking, long tool inputs and long outputs are all past it by construction; off that runtime there is no in-loop deadline at all.

Real failures keep the bounds that key off evidence rather than absence: the engine's `FIRST_STREAM_EVENT_TIMEOUT_MS` for a stream that opens and never speaks, the run-manager backstop outside the stream, the per-tool execution timeout, the chunk/run budget, and the stale reaper. The trade is explicit: an in-stream wedge after the first frame is now caught by the run budget rather than at 90s, because no clock in the loop could tell it apart from a model writing a large tool call.

Separately, `runAgentLoop` now takes the caller's real chunk budget instead of re-deriving one. It asked `resolveRunSoftTimeoutMs` for the generic background ceiling (13 min) even when the caller was a background automation, whose budget is its own hard abort minus headroom (10 min − 20s). The per-tool ceiling came out above the run budget, so every per-tool timeout on that path was dead code and the chunk boundary won instead — the exact inversion `RUN_TOOL_TIMEOUT_HEADROOM_MS` exists to prevent, reintroduced by guessing at a number the caller already had.
