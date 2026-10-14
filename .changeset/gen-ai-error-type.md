---
"@agent-native/core": patch
---

Failed model calls now record why they failed as `error.type` on `gen_ai.client.operation.duration` (for example `http_429`, `http_529`, or `provider_error`) instead of always `_OTHER`, so LLM failure-rate dashboards and alerts can tell provider throttling from outages.
