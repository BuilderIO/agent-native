---
"@agent-native/core": patch
---

Recover unclaimed background chats from the durable scheduler, including when recurring jobs are disabled. Preserve retryable dispatch payload reads and ordered run event persistence so missing events cannot become a successful completion.

Report guardrail stops and exhausted empty responses as failures, stop workers when required prompt preparation times out, and preserve provider-requested retry delays from Builder HTTP responses.
