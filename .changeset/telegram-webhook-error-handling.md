---
"@agent-native/core": patch
---

Return 422 instead of 502 on Telegram webhook registration failures, surface the provider description in the response body, and validate that `TELEGRAM_WEBHOOK_SECRET` matches allowed characters (`^[A-Za-z0-9_-]{1,256}$`) when saving credentials and registering webhooks.
