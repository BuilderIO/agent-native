---
"@agent-native/core": minor
---

Seamless bridge to external coding agents (Claude Code, Cowork, Codex). Actions
gain an optional `link` builder; MCP tool results now append an "Open in … →"
deep link (`_meta["agent-native/openLink"]` + markdown). New
`/_agent-native/open` route bridges those links to the existing
`navigate`/`application_state` mechanism, scoped to the browser session. Adds
`buildDeepLink`/`toAbsoluteOpenUrl`/`toDesktopOpenUrl` helpers, an
`agent-native mcp` CLI (serve/install/uninstall/status/token) with stdio
transport + one-command install for Claude Code/Codex/Cowork, and generic
cross-app MCP tools (`list_apps`, `open_app`, `ask_app`, `create_workspace_app`,
`list_templates`). All additive and backward compatible.
