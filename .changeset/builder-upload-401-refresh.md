---
"@agent-native/core": patch
---

Builder.io asset uploads (signed URL, small-file, and upload-complete requests) now refresh the OAuth access token and retry once when refused with 401, instead of failing on a token that was revoked or rotated before its stated expiry. The retry only happens when the refresh produced a different token. `resolveOAuthCredentialAccess` gains a `forceRefresh` option that refreshes even a token with no stated expiry, and `resolveBuilderApiAuthorization`, `resolveBuilderRequestAuthorization`, `getBuilderOAuthSession`, and `getMcpOAuthAccessToken` pass it through.
