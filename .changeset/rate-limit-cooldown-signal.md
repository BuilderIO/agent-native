---
"@agent-native/core": patch
---

Stand speculative route warmup down when the origin returns 429 instead of retrying it, and share one rate-limit cooldown across the polling loops so a throttled origin is not kept throttled by the client's own retries.
