---
"@agent-native/core": patch
---

Encrypt OAuth tokens at rest. The `oauth_tokens` table previously stored the
full bundle — including long-lived Google refresh tokens — as plaintext JSON,
so a leaked DB backup / pg_dump / read replica exposed usable credentials.
`saveOAuthTokens` now AES-256-GCM-encrypts the bundle with the same key story
as the secrets vault and per-user credentials; reads decrypt transparently and
fall back to plaintext for rows written before this change (and for Better
Auth's mirrored `account` rows). Adds an optional, idempotent
`db-migrate-encrypt-oauth-tokens` script to re-encrypt existing rows in place.

Also exposes the AES-256-GCM helpers (`encryptSecretValue`,
`decryptSecretValue`, `isEncryptedSecretValue`) from `@agent-native/core/secrets`
and a focused `@agent-native/core/secrets/crypto` subpath, so templates can
encrypt per-row secret values (e.g. a per-recording share password) that don't
fit the keyed app_secrets / credentials stores.
