---
"@agent-native/core": patch
---

A chat keeps its delegations after a reload: the saved AgentKit history now stores delegated agents, their interactions, their activities (with the agent they belong to and a bounded text summary, never the raw snapshot) and their tasks, so a reloaded chat shows the same Subagent steps.
