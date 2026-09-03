---
"@agent-native/core": patch
---

`decodeOAuthState` no longer returns a success-shaped object on a missing,
tampered, or malformed OAuth `state` parameter — it now returns a
discriminated `{ ok: true, ...payload } | { ok: false, reason, redirectUri }`
result, so a bad-signature or corrupted state (e.g. a rotated
`OAUTH_STATE_SECRET`/`BETTER_AUTH_SECRET`) can no longer be silently processed
as an anonymous plain sign-in with owner/org/desktop context dropped. All 13
callers now check `ok` and log a structured
`[agent-native][oauth] state decode failed` warning (via the new
`logOAuthStateDecodeFailure`) before falling back to their existing OAuth
error page.

`checkGoogleSignInCredential` and `checkGoogleManagedCredential` accept an
optional `redirectUri` and, when supplied, also probe Google's authorize
endpoint (`probeGoogleRedirectUri`) to classify it as `registered`,
`mismatched`, or `unknown` — the credential-only token-exchange probe used a
constant fake redirect URI and structurally could not detect
`redirect_uri_mismatch`, the most common real Google OAuth failure.

`describeGoogleSignInCredentialPairs` gained test coverage confirming
`mismatched` is a plain fact about the two credential pairs, independent of
credential mode.
