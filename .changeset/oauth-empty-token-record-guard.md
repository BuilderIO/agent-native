---
"@agent-native/core": patch
---

`isOAuthConnected` no longer reports an account as connected when its stored token bundle parses to an empty object — the signature of an `oauth_tokens` row that failed to decrypt after a `SECRETS_ENCRYPTION_KEY` / `BETTER_AUTH_SECRET` rotation. Previously such rows kept the provider looking "connected" while every API call failed with an undefined bearer token, hiding the reconnect banner. Unusable rows are deliberately not deleted, since a decrypt failure can also mean the current process holds the wrong key (e.g. a dev server sharing a prod database) while the row is still decryptable by a correctly configured deployment.
