---
"@agent-native/core": patch
---

Track usage of the MCP server an app exposes. Every `initialize`, `tools/list`, `tools/call`, `resources/list`, and `resources/read` now emits an analytics event through the framework's provider-agnostic `track()`, so the metrics land in whichever provider the app has configured (PostHog, Mixpanel, Amplitude, webhook, Agent-Native Analytics).

Event and property names follow PostHog's MCP analytics vocabulary — `$mcp_tool_call`, `$mcp_tool_name`, `$mcp_duration_ms`, `$mcp_is_error`, `$mcp_client_name`, `$mcp_vendor_client`, … — so PostHog's MCP dashboards work with no mapping layer. Both transports report identically: the events are emitted from the shared server builder, with the handshake captured at the HTTP mount where the client's own name and version are on the wire.

Tool results are never sent. Tool arguments are off by default; set `MCP_ANALYTICS_PARAMETERS=true` (`observability.mcpCaptureParameters`) to include them as redacted `$mcp_parameters`, or `MCP_ANALYTICS=false` (`observability.mcpEvents`) to turn the events off entirely.
