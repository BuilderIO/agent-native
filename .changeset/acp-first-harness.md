---
"@agent-native/core": minor
---

feat(harness): add ACP stdio adapter as the primary built-in harness

Registers `acp:stdio` as the first built-in harness adapter via the Agent Client
Protocol (`@agentclientprotocol/sdk`). Any ACP-compatible agent binary can now be
wired through `resolveAgentHarness("acp:stdio", { command, args })`. The three
existing AI SDK adapters (`ai-sdk-harness:claude-code`, `ai-sdk-harness:codex`,
`ai-sdk-harness:pi`) remain registered as compatibility alternatives.

Exports: `createAcpStdioHarnessAdapter`, `acpSessionUpdateToEvents`,
`chooseAcpPermissionOption`, and associated types from `@agent-native/core/agent/harness`.
