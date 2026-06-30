---
"@agent-native/core": patch
---

Allow a shared deployment OAuth client for authenticated users. OAuth *client*
credentials (`GOOGLE_CLIENT_ID/SECRET`, `GOOGLE_SIGN_IN_CLIENT_*`,
`GITHUB_CLIENT_*`) are deployment-wide identity, not per-tenant secrets — every
user authorizes the same app for their own account and gets their own tokens.
`resolveSecret` now lets these keys fall back to the deploy env even for
signed-in users in a hosted runtime (the same treatment Builder credential keys
get), so one deployment can offer a single "Sign in with Google" instead of
forcing every user to register their own Google Cloud OAuth app. A per-tenant
client (BYO upload) still wins — user/org/workspace scopes are resolved first.
