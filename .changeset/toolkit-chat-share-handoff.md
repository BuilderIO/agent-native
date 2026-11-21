---
"@agent-native/toolkit": patch
---

An app can now handle the chat share menu's "Open in Claude / Claude Code / Codex" choices itself. Pass `onAgentShareHandoff` to `AgentSidebar` or `ShareButton` and it receives the destination, the agent-read prompt, the share link and the resource, instead of the browser launching a native app. A `sendTo.openInAgent` you pass still takes priority, and without either the menu opens the native app as before.
