---
"@agent-native/core": patch
---

Treat Anthropic/Builder bare "Connection error." failures as retryable network interruptions so agent runs resume instead of dying in a few seconds and storming client recovery POSTs.
