---
"@agent-native/core": patch
---

Classify BYO-provider rate limits (HTTP 429) as retryable. The native Anthropic and AI-SDK engines now forward the provider HTTP status as a structured `http_<status>` errorCode + `statusCode` for every failure (not just 401), so a bare "429 status code (no body)" surfaces as `http_429`. `isRetryableError` also matches `http_429` and bare `429` messages. Previously a directly-connected provider key that Anthropic rate-limited failed hard instead of backing off and retrying like the Builder gateway path does, and rate-limited runs can now auto-continue.
