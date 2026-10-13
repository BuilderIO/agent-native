---
"@agent-native/core": patch
---

Export `getBetterAuthUserIdForEmail` from `@agent-native/core/server` and `readAnalyticsAnonymousId` from `@agent-native/core/tracking`, so app server routes can key their own analytics events to the same user and anonymous visitor ids that signup tracking uses.
