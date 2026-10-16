---
"@agent-native/core": patch
---

Upgrade known-outdated saved model ids (for example `claude-sonnet-5` on Anthropic or `gpt-5.6-luna` on OpenAI endpoints) to the current model on every engine, while keeping ids the provider still supports and genuinely custom ids unchanged.
