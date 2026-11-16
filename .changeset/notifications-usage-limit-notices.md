---
"@agent-native/core": patch
---

Add the `notifications.usageLimitNotices` server config (env `AGENT_NATIVE_NOTIFICATIONS_USAGE_LIMIT_NOTICES`, default `true`). When `false`, usage-limit alerts are left out of the notifications inbox, its unread count, and bulk archiving.
