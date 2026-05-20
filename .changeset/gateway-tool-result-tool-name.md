---
"@agent-native/core": patch
---

Include `tool_name` and `tool_input` on every `tool_result` sent to the Builder LLM gateway (Gemini compatibility), backfill from prior `tool_use` when replaying history, add gateway client identification headers, and require `toolName`/`toolInput` on engine tool-result parts. Preserve unmatched structured-history tool results as text (then run `backfillEngineMessagesToolResults`) so replay never drops that payload before backfill runs. `backfillEngineMessagesToolResults` now turns orphan engine `tool-result` parts into the same replay text (instead of silently dropping them), and structured history coerces legacy non-string `toolCallId` / `content` shapes from stored JSON.
