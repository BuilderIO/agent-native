---
"@agent-native/core": patch
---

Make MCP reconnect more resilient when OAuth metadata discovery is temporarily
unavailable by retrying discovery and falling back to bearer-token reconnect for
existing connectors.
