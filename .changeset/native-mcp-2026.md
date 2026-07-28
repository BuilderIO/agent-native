---
"@agent-native/core": minor
"@agent-native/pinpoint": patch
---

Serve the stateless MCP 2026-07-28 protocol natively while preserving stateless
legacy clients, automatically negotiate the newest supported protocol from
outbound clients and stdio bridges, and harden MCP OAuth issuer, client type,
scope, credential binding, and Client ID Metadata Document behavior. Require
durable, single-use MCP 2026 approval elicitation before running actions marked
`needsApproval`.

Update the Pinpoint MCP server example to use the stable split MCP v2 packages.
