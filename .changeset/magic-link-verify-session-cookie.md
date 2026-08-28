---
"@agent-native/core": patch
---

Fix magic-link sign-in dropping the session on the verify redirect when Better Auth only emits `set-auth-token`.
