---
"@agent-native/core": patch
---

Export `getBetterAuthUserIdForEmail` and `platformWaitUntil` from `@agent-native/core/server` and `readAnalyticsAnonymousId` from `@agent-native/core/tracking`, so app server routes can key their own analytics events to the same user and anonymous visitor ids that signup tracking uses, and keep post-response work alive on Netlify, where Nitro drops `event.waitUntil`.
