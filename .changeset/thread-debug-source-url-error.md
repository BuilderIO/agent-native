---
"@agent-native/dispatch": patch
---

Thread Debug now trims cross-app source database URLs and, when one is not a PostgreSQL URL, reports which source and environment variable is misconfigured instead of a generic `DATABASE_URL` error.
