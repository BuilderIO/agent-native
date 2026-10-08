---
"@agent-native/core": patch
---

Cut serverless cold-start time for action-heavy apps: `defineAction` no longer converts an action's full schema to JSON Schema when a compact `agentInputSchema` is set, since only the compact one is ever advertised (Plan's cold import drops from about 2.3s to 0.8s in a local CI-shaped build).
