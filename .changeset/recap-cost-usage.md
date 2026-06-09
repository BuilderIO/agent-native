---
"@agent-native/core": patch
---

Capture LLM token usage and a derived cost estimate for PR Visual Recaps. The
recap workflow now emits machine-readable usage from the Claude Code / Codex run
and a new `agent-native recap usage` CLI subcommand parses it (normalizing the
Anthropic-vs-OpenAI cache-token accounting asymmetry) and attaches it to the
published recap. `recordUsage` gains optional `refId` (idempotent
replace-on-rewrite) and `costCentsX100` (store a provider-reported cost
verbatim) fields plus a `ref_id` column, and the model pricing table gains
OpenAI `gpt-5` / `gpt-5.5` rows so Codex recaps are not priced as Sonnet.
