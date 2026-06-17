---
"@agent-native/core": patch
---

Add a hard delegation-depth guardrail so sub-agents cannot infinitely spawn
sub-agents. Each sub-agent now carries its delegation depth (top-level chat is
0); `spawnTask` refuses server-side once a spawn would exceed the cap, returning
a clear "Delegation depth limit reached" error to the parent agent. Enforcement
lives in `agent-teams.ts` and reads the spawning agent's depth from the ambient
run context, so it holds even if the team tool is not stripped. The cap defaults
to 2 and is configurable via the `AGENT_NATIVE_MAX_SUBAGENT_DEPTH` env var
(parsed and clamped, falling back to the default on invalid values).
