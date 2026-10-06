---
"@agent-native/core": patch
---

Fix event-triggered automation conditions failing with "No API key is available to evaluate this automation's condition" for owners whose only usable LLM credential is Builder Gateway or a non-Anthropic provider key. The condition evaluator now resolves its model through the same engine registry (`resolveEngine`) used by interactive chat and the automation's own run, instead of hardcoding a direct call to Anthropic's API with a raw provider key.
