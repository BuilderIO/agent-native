---
"@agent-native/core": patch
---

Fix magic-link sign-in dropping the session after verify. Better Auth's `set-auth-token` is a signed `token.signature`, which is not the session table row. `getSession` now tries the unsigned token, decodes percent-encoded cookies before asking Better Auth, and persists that unsigned token as the framework session cookie.
