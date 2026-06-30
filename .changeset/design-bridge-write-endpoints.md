---
"@agent-native/core": minor
---

Add secure localhost bridge write endpoints to the design connect bridge.

`startDesignConnectBridge` now mints a cryptographically random per-session
`bridgeToken` (exposed on the returned `DesignConnectBridge` object) and
serves three new token-gated POST endpoints on the same localhost-only server:

- `POST /read-file` — reads any file within the root (no extension restriction)
- `POST /write-file` — writes `.html`, `.htm`, or `.css` files within the root
- `POST /apply-edit` — patches an existing file via `{search, replace}` or
  replaces it entirely via `{content}`

All three endpoints require the `X-Bridge-Token` header to match the minted
token (constant-time comparison). Path confinement is enforced via
`fs.realpath` on both the root and the target parent directory, blocking
directory traversal and symlink escape attacks. The token is never serialised
into the public `/manifest.json` response.

The `DesignConnectManifest` capabilities array now marks `readFile`,
`applyEdit`, and `writeFile` as `"available"` (previously `"planned"`).
