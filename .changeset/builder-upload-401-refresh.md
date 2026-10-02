---
"@agent-native/core": patch
---

Builder.io asset uploads now refresh the OAuth access token and retry once when the signed-URL or upload-complete request is refused with 401, instead of failing the upload on a token that was revoked or rotated before its stated expiry. `resolveBuilderApiAuthorization`, `resolveBuilderRequestAuthorization`, `getBuilderOAuthSession`, and `getMcpOAuthAccessToken` accept an optional `forceRefresh`.
