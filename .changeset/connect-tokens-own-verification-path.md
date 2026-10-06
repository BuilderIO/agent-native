---
"@agent-native/core": patch
---

Connect tokens work again in an organization whose A2A secret matches the deployment's `A2A_SECRET`. Tokens from the `/mcp/connect` terminal flow and from "Generate a static token" lost their subject there and got a bare 401 at `/mcp` and the action routes, while OAuth connectors kept working. Connect now always mints an MCP OAuth access token bound to the app's MCP URL. `verifyAuth` recognizes every credential the app issued, including connect tokens in the earlier A2A format, before any cross-app A2A rule runs, and admits them all through one path. Earlier-format connect tokens verify only with the deployment `A2A_SECRET`, and their stored row supplies their identity.

A refused bearer token now says why. The 401 body carries a `reason` (`invalid`, `revoked`, `unknown-connect-token`, `identity-mismatch`, `not-member`, or `email-retired`) and a message naming the reconnect URL. On `/mcp` the `WWW-Authenticate` challenge adds `error="invalid_token"` and the same `error_description`. Org service tokens minted in the MCP OAuth format now carry service identity assurance, not user assurance.
