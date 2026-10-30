---
"@agent-native/core": patch
---

Route each Netlify workspace app's OAuth discovery requests to that app. Dispatch's `/.well-known/*` function path overlapped the apps' own discovery paths, and Netlify picks the function whose name sorts first, so apps after "dispatch" (for example `sales-tools`) advertised Dispatch's authorization server and MCP clients could not sign in to them.
