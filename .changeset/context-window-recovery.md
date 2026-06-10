---
"@agent-native/core": minor
---

Add per-model context window table and one-shot overflow recovery

- `model-config.ts`: new `getContextWindowForModel(modelId)` helper and explicit
  context-window table covering all catalog models. Claude Sonnet 4.6 / Opus 4.7+
  = 1 M, Haiku 4.5 / Fable 5 = 200 K, GPT-5.4/5.5 = 1.05 M, Gemini 2.x/3.x
  = 1 M, unknown models = conservative 128 K default.

- `client/context-xray/format.ts`: new `resolveContextWindow(modelId?)` helper
  that replaces the hard-coded 200 K constant in `ContextMeter` and
  `ContextXRayPanel` so the gauge and headroom calculation reflect the real
  window for large-context models.

- `agent/production-agent.ts`: context-window overflow is no longer a terminal
  dead-end. On the first overflow the agent attempts one automatic recovery pass:
  old tool-result content (outside the most-recent 10-message tail) is replaced
  with a short stub and the engine call is retried once. Only if that second
  attempt also overflows does the terminal error fire — with updated copy that
  explains the recovery attempt and suggests continuing in a new chat or asking
  the agent to summarize. New exported pure helper `trimOldToolResults` is
  unit-tested independently.

- `client/error-format.ts`: `context_length_exceeded` / `input_too_long` errors
  now append a "Start new chat" CTA link (matching the `builder_gateway_error`
  pattern) so users have a one-click escape path from the error card.
