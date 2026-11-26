---
"@agent-native/core": patch
---

Don't issue MCP or connect credentials to the `AUTH_DISABLED` dev identity outside local development. MCP OAuth consent, connect token minting and device approval now refuse the `dev@local.test` session unless the request comes from this machine over loopback, and MCP and connect credentials owned by that identity are accepted only on loopback requests.
