---
"@agent-native/core": patch
---

MCP OAuth connections now report where people drop off. Opening the authorize page sends `$mcp_oauth_authorize_opened` (with whether the visitor was already signed in), and showing the sign-in page sends `$mcp_oauth_login_wall_shown`. Both carry the connecting client's name and vendor, the redirect host, `$mcp_oauth_route` (`directory` or `mcp`) and the same app label as `agent_connected`, so a client's starts and finished connections can be compared. They never include PKCE values, state, client ids or the redirect path. Measurement only: the authorize flow behaves exactly as before, and a tracking failure is logged instead of failing the sign-in.
