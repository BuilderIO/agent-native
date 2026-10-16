---
"@agent-native/core": patch
---

Upgrade known-outdated saved model ids (for example `claude-sonnet-5` on Anthropic) to the current model on every engine, while keeping ids the provider still supports, genuinely custom ids, and every id sent to a custom OpenAI-compatible endpoint unchanged.
