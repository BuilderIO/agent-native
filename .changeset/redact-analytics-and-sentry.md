---
"@agent-native/core": patch
---

Redact secrets in server `track()` properties, browser and server Sentry events and spans (by key name, in text, and in request URLs and query strings), and drop Sentry request headers named for a secret, token or signature. A `token`, `distinct_id` or `time` property can no longer replace Mixpanel's project token, user or event time.
