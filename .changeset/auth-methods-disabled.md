---
"@agent-native/core": patch
---

Fix `get-auth-methods` returning a 401 for callers the framework authenticated without a Better Auth session cookie (e.g. AUTH_DISABLED dev sessions), which made the Account settings password row always show the no-password state.
