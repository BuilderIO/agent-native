---
"@agent-native/core": patch
---

Make the stateless MCP server serverless-safe so remote hosts (Claude Code,
etc.) can actually complete `tools/call`. Two changes to the Streamable HTTP
transport: (1) `enableJsonResponse: true` so request/response is returned as
JSON inside the request lifecycle instead of an SSE event pushed after a
serverless instance has frozen (which dropped the result and surfaced as
"session expired"); (2) answer `405` for `GET` so clients don't latch onto a
standalone server-to-client SSE stream a stateless per-request instance can't keep
alive ("not connected"). Inline MCP App rendering and direct tool calls now
work over the hosted connectors.
