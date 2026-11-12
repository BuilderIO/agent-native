---
"@agent-native/core": patch
---

Record which MCP client made a review suggestion. A suggestion now keeps whether it came over MCP, from another app's agent or from the app's own agent, and the connect host its client named, such as Claude Code or Codex. The host comes from the client's `clientInfo` name, or else its User-Agent, and is only a label: the client's own claim, never used to grant access.
