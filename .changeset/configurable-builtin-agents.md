---
"@agent-native/core": minor
"@agent-native/dispatch": minor
---

Let workspaces choose which hosted first-party apps they offer with `agent-native.builtinAgents` (`mode: "all" | "none" | "selected"`, `include`, `defaultEnabled`), and let org admins enable or disable offered apps per organization from Dispatch Settings or the new `list-builtin-agents` and `set-builtin-agents-enabled` actions. Discovery, the MCP gateway, agent-to-agent calls, and Dispatch's app list all respect both layers; MCP app access is now only a routing permission. Built-in URLs resolve to production outside the framework monorepo.
