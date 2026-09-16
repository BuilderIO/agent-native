---
"@agent-native/core": patch
---

Stop offering a Connect button for MCP servers whose authorization server
cannot register a client, and stop rendering the failure as raw JSON. GitHub's
authorization server (`https://github.com/login/oauth`) advertises no
`registration_endpoint` and no Client ID Metadata Documents, so every
`Connect GitHub` click ran dynamic client registration that could not succeed
and painted `{"error":"This MCP server could not start OAuth..."}` across the
OAuth popup.

The GitHub catalog entry now uses a personal access token on the
`Authorization` header, which is the connection its remote endpoint actually
accepts. Independently of GitHub, an OAuth start that dies for want of a
registerable client is now a distinct, non-retryable failure that names the
authorization server and the token alternative, and every refusal in the MCP
OAuth start and callback routes renders as a page for the browser that opened
it instead of a JSON body.
