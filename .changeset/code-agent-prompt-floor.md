---
"@agent-native/core": patch
---

Raise coding agent maxIterations from 12 to the shared DEFAULT_AGENT_MAX_ITERATIONS (100) and inject AGENTS.md/CLAUDE.md + .agents/skills index into the system prompt so the coding agent respects repo instructions and knows what skills are available.
