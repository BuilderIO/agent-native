---
"@agent-native/core": patch
"@agent-native/frame": patch
---

Default the framework to the Builder gateway's `gpt-5-5` model alias, split provider-native default IDs (`DEFAULT_OPENAI_MODEL` / `DEFAULT_ANTHROPIC_MODEL`) so direct BYOK engines stay on valid provider IDs, and stop hard-coding `DEFAULT_MODEL` for A2A / MCP / integrations runs — the resolved engine's default is used instead. Also adds a "Use Builder" cloud CTA alongside the Desktop CTA in the AgentPanel and CodeRequiredDialog code-access-unavailable surfaces, including a `useBuilderConnectUrl()` hook that wires up the secondary link from `/_agent-native/builder/status`.
