---
"@agent-native/core": patch
---

A resumed turn now reports why an earlier write's outcome is unknown: `agent_run_terminal` gives `blocked_by: rejection` when the call returned a failure, instead of always `interruption`.
