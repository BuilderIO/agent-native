---
"@agent-native/core": patch
---

MCP OAuth connections now report where people drop off. Serving the authorize page (the sign-in page or the consent page) sends `$mcp_oauth_authorize_opened` (with whether the visitor was already signed in), and serving the sign-in page also sends `$mcp_oauth_login_wall_shown`. Silent `prompt=none` checks and requests answered with an error or redirect serve no page and are not counted. Both events carry the connecting client's name and vendor, the redirect host, `$mcp_oauth_route` (`directory` or `mcp`) and the same app label as `agent_connected`, so a client's starts and finished connections can be compared. They never include PKCE values, state, client ids or the redirect path. Measurement only: the authorize flow behaves exactly as before, and a tracking failure is logged instead of failing the sign-in.
