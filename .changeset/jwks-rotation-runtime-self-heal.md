---
"@agent-native/core": patch
---

Self-heal Better Auth JWKS keys orphaned by a `BETTER_AUTH_SECRET` rotation. The JWT plugin decrypts the persisted signing key on every `get-session`, so a rotated secret used to 500 every session check and sign the whole deployment out. The key is now verified against the live secret when that failure appears, stale rows are expired so a fresh key is minted, and the optional `set-auth-jwt` header is skipped (loudly) rather than failing the session response if recovery cannot help.
