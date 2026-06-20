---
"@agent-native/core": minor
---

Add an ACP (Agent Client Protocol) harness adapter so Agent-Native can act as an
ACP client and drive local coding agents — Gemini CLI, Claude Code, or any
ACP-compliant agent — through the existing `AgentHarness` substrate.

`createAcpHarnessAdapter({ command, args })` spawns the agent over stdio and
maps ACP `session/update` notifications, permission requests, and `fs/*` calls
onto harness events, approvals, and file-change events. Built-in presets
`acp:gemini` and `acp:claude-code` are registered by
`registerBuiltinAgentHarnesses()`, alongside a generic `acp` entry. The protocol
transport (`@zed-industries/agent-client-protocol`) loads lazily as an optional
dependency.
