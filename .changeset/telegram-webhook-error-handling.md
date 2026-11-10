---
"@agent-native/core": patch
---

Return 422 for Telegram webhook client/validation rejections and 424 (Failed Dependency) for upstream provider outages or network failures, carrying `upstreamStatus` in the response body. Also validate that `TELEGRAM_WEBHOOK_SECRET` matches allowed characters (`^[A-Za-z0-9_-]{1,256}$`) when saving credentials and setting up webhooks.
