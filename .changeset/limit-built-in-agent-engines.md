---
"@agent-native/core": minor
---

Add `agent.builtInEngines` so a deployment can choose which built-in agent engines are registered. Unset registers every built-in, as before; setting it (in `defineAppConfig()` or via `AGENT_BUILT_IN_ENGINES`) registers only the named ones, so the rest never appear in the model picker and never resolve by name. An unknown name is a configuration error rather than a silently ignored entry.
