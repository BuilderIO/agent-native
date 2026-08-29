---
"@agent-native/core": patch
---

Fix magic-link sign-in dropping the session after verify. Hosted 302s were keeping `set-auth-token` and omitting `Set-Cookie`. The continue page now sets only first-party Lax cookies (Better Auth's Partitioned cookies are dropped) and persists that token so `/session` can resolve it.
