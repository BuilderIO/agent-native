---
"@agent-native/core": patch
---

Keep replayed conversations faithful to what the agent actually did.

- Resuming a run (chained background continuation, agent-teams `continue`) now
  replays the tool calls and results stored in `thread_data` instead of
  flattening each turn to its prose, so a resumed chunk can see the output of
  work already committed rather than re-running it. Integration turns keep their
  existing delivered-text-only replay policy, and each replayed result is bounded
  with an in-band truncation notice.
- The outbound history window no longer slides by one message per turn. Every
  prompt cache matches a byte-identical prefix, so a window that moved every turn
  meant no cached prefix ever matched once a thread passed the message cap, and
  the whole conversation was re-billed at write price on every turn. The window
  start is now quantized to a stride.
- Anthropic `redacted_thinking` blocks survive normalization and replay verbatim.
  They were silently dropped as an unknown block type, which left the next
  iteration of a tool-use turn sending an assistant turn the API rejects.
  Unrecognized content block types now warn instead of vanishing.
- Reducing a long thread is Observational Memory's job, but its Observer only
  engages past 30k unobserved tokens while a 24-message count cap bit long
  before that, so turns left the request while compaction still had nothing to
  say about them. The count cap is now a backstop well above that threshold; the
  two char budgets remain the real bound on what a request carries.
- A thinking block with no signature is dropped with a warning instead of being
  sent with an empty one, which the native API rejects outright — failing the
  whole turn on a provider error that points nowhere near the cause. The Builder
  gateway path is unchanged, since its tolerance here is unverified.
