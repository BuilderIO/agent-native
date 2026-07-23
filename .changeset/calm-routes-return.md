---
"@agent-native/core": patch
---

Keep cross-app `ask_app_status` polling attached to the original task route with an encrypted task handle, report the configured app identity in standalone MCP discovery, and reject unknown cross-app targets instead of running them locally.
