---
"@agent-native/core": patch
---

Make the agent output-token ceiling configurable and stop scheduled runs from silently getting a smaller one than chat.

- `agent.maxOutputTokens` (env `AGENT_MAX_OUTPUT_TOKENS`), `agent.mainChatMaxOutputTokens` (default 64K) and `agent.emptyResponseRetryMaxOutputTokens` (default 128K) are declared app-config fields, so the global cap is no longer a bare `process.env` read and an app can set it from `defineAppConfig`. Every value is still clamped down to the model's documented ceiling.
- The background automation runner now passes the same model-aware ceiling the interactive paths pass. It previously passed none, so every scheduled job and dispatched automation ran at the flat per-engine default — a lower completion budget than chat, on exactly the runs that emit the largest single tool call.
- A `max_tokens` stop is now recognised as truncation when tool-call parts are present, not only when they are absent. A tool call cut off mid-arguments used to read as a schema error: the model was told to "retry with arguments that match the tool schema" and re-sent the same oversized payload against the same ceiling until the identical-error breaker ended the turn, with the tool never executed. The retry now raises the ceiling and the error names the real cause.
