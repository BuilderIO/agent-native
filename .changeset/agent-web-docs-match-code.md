---
"@agent-native/core": patch
---

The agent web docs now describe what the code does: `createAgentWebVitePlugin` publishes only the pages you pass it, and `publicMcp`, `jsonLd` and `publicAgentCard` are accepted but unused. Only an action's own `publicAgent` opt-in exposes it to outside agents.
