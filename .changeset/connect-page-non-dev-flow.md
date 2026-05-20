---
"@agent-native/core": patch
---

`/_agent-native/mcp/connect` now leads with the no-CLI path: the remote MCP URL is shown with a copy button, and a Claude/ChatGPT/Cursor/Claude Code/Codex/Other tab strip walks users through each host (paste-the-URL for OAuth hosts, one-line `claude mcp add` / `npx @agent-native/core connect` snippets for CLI hosts) so non-developers can connect a chat host without ever opening a terminal. The static-token mint flow and connections list keep their existing endpoints; tests cover the new sections.
