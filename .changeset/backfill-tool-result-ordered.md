---
"@agent-native/core": patch
---

Fix `backfillEngineMessagesToolResults` so a `tool-result` is only paired with `tool-call`s from assistant messages that appeared earlier in the conversation. The previous global lookup overwrote earlier entries when ids collided (e.g. reused `continuation_tc_*` ids after adapter recreation), causing older history to be backfilled with the wrong `tool_name` / `tool_input` and sent that way to the Builder LLM gateway.
