---
"@agent-native/core": patch
"@agent-native/toolkit": patch
---

Add an Add to Claude button to the Claude MCP setup guide that opens Claude's add-connector dialog with the app name and MCP URL filled in, with the manual steps kept under Manual setup. The Claude Code command now adds the server with `--scope user` so it works in every project, and the VS Code fallback points to Chat: Open Customizations → MCP Servers.
