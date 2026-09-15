---
"@agent-native/core": patch
---

Keep the client session gate retrying for a 30s wall-clock budget instead of four attempts, so an instantly-failing session endpoint no longer shows "We couldn't reach the server to confirm your session" about six seconds into a cold start. A read superseded by a cache invalidation is now tracked separately from an unreadable one and no longer spends the budget.
