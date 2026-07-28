---
"@agent-native/core": minor
"@agent-native/pinpoint": patch
---

Serve the stateless MCP 2026-07-28 protocol natively while preserving stateless
legacy clients, automatically negotiate the newest supported protocol from
outbound clients and stdio bridges, and harden MCP OAuth issuer, client type,
scope, and credential binding behavior.

Update the Pinpoint MCP server example to use the stable split MCP v2 packages.
