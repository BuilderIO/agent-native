---
"@agent-native/core": patch
---

Encrypt per-user / per-org credentials at rest. `saveCredential` /
`resolveCredential` previously stored third-party API keys as plaintext in the
`settings` table; they now AES-256-GCM-encrypt values using the same key
material as the secrets vault (`SECRETS_ENCRYPTION_KEY` / `BETTER_AUTH_SECRET`),
so a leaked DB backup / pg_dump / read replica no longer exposes plaintext keys.
Reads transparently fall back to legacy plaintext rows, so nothing breaks during
rollout. A one-shot, idempotent, non-destructive migration
(`pnpm action db-migrate-encrypt-credentials`) re-encrypts existing rows in
place. The encryption helper is now shared between the secrets vault and
credentials (`secrets/crypto.ts`); behavior of the vault is unchanged.
