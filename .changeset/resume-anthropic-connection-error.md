---
"@agent-native/core": patch
---

Treat Anthropic/Builder bare "Connection error." failures as retryable network interruptions, and stop mislabeling those failed runs as stale_run when the client reconnects past the real terminal event.
