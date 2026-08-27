---
"@agent-native/core": minor
---

Make the read-only source/search convergence budget configurable as `agent.sourceSweepToolCallThreshold` (env `AGENT_SOURCE_SWEEP_TOOL_CALL_THRESHOLD`), and raise its default from 12 to 24 tool calls per turn. Research-shaped apps that legitimately inspect many records were hitting the guard mid-task; a deployment can now tune the budget instead of living with a hardcoded constant.
