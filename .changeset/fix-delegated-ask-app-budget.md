---
"@agent-native/core": patch
---

Raise the default delegated agent-loop token budget (used by cross-app A2A calls and same-app `ask_app` MCP calls) from 750,000 to 5,000,000 input tokens. The old value was too low for tool-heavy apps and could trip `run-input-token-budget` on every multi-step turn regardless of task size.
