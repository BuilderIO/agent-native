---
"@agent-native/core": patch
---

Deliver integration identity notices through the durable webhook queue, fail closed for anonymous Slack direct messages unless explicitly enabled, preserve verified identity through transient re-hydration failures, redact signed object URLs from replays, and bound retryable replay upload failures.
