---
"@agent-native/core": patch
---

Allow native/desktop IDE clients (Cursor, VS Code) to complete the remote MCP
OAuth flow. The Dynamic Client Registration endpoint previously rejected any
`redirect_uris` that were not `https://` or `http://localhost`, so IDEs that
register a private-use URI scheme callback (e.g. `cursor://…`, `vscode://…`,
permitted by RFC 8252 §7.1) failed at registration with
`invalid_client_metadata` and never obtained a token. Registration now also
accepts private-use schemes while still requiring PKCE and rejecting
script/file-capable schemes (`javascript:`, `data:`, `file:`, `blob:`,
`vbscript:`, `about:`), fragments, and embedded credentials.
