---
"@agent-native/core": patch
---

Fix `agent-native code` crashing with `Unknown engine: "codex-cli"` when the Codex CLI runner is selected via the `AGENT_ENGINE` environment variable. The Codex branch in `executeCodeAgentRun` now falls back to `AGENT_ENGINE` the same way `resolveExecutorEngine` already does, so `AGENT_ENGINE=codex-cli` routes to the Codex CLI runner instead of being handed to the LLM-provider engine resolver (which only knows the AI-SDK providers).
