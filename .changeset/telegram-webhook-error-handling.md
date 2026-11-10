---
"@agent-native/core": patch
---

Classify Telegram webhook setup failures with appropriate status semantics: 422 for client/validation rejections, 429 for provider rate limits, and 424 (Failed Dependency) for upstream provider outages or network failures, forwarding `upstreamStatus` across both HTTP routes and action execution error details. Also validate that `TELEGRAM_WEBHOOK_SECRET` matches allowed characters (`^[A-Za-z0-9_-]{1,256}$`) when saving credentials and registering webhooks.
