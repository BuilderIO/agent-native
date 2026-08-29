---
"@agent-native/core": patch
---

Fix magic-link sign-in dropping the session after verify. Persist the raw `set-auth-token` (the session table token) as the framework cookie, keep Better Auth's own cookies, and expire the previous Lax rewrite so a stale encoded cookie cannot win. `getSession` also waits for Better Auth and passes a real Cookie header.
