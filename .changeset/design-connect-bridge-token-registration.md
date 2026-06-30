---
"@agent-native/core": patch
---

Fix bridge token registration so design localhost write-back works end-to-end.

`registerConnectionWithServer` is a new exported function that POSTs the
bridge's real `bridgeToken` (minted by `startDesignConnectBridge`) to the
design app's `connect-localhost` action endpoint on startup. This stores the
token on the `designLocalhostConnections` row so `grant-localhost-write-consent`
can read it instead of minting an unrelated token, which previously caused every
bridge write to return 401.

`DesignConnectArgs` gains an optional `appUrl` field (populated by the new
`--app-url <url>` CLI flag or the `AGENT_NATIVE_URL` / `DESIGN_APP_URL` env
vars) that controls where self-registration is sent. Registration is
best-effort: if no app URL is configured or the request fails, the bridge
continues running normally.
