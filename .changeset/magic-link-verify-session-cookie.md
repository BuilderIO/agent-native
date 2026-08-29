---
"@agent-native/core": patch
---

Fix magic-link sign-in dropping the session after verify. Hosted 302s were keeping `set-auth-token` and omitting `Set-Cookie`, so the continue page now sets a first-party Lax session cookie before following through.
