---
"@agent-native/core": patch
---

`agent_run_terminal` reports why an earlier write's outcome is unknown, including on a resumed turn: `blocked_by` is `rejection` when the call failed and said so, `unattributed` when it returned but its effect could not be attributed, and `interruption` when its result never came or nothing recorded a cause. The stop message the agent gives says the same.
