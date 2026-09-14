---
"@agent-native/core": patch
---

Show ordinary chat turns in the Agent runs tray. The tray only read explicit
progress rows and the Agent Teams / harness background listings, so it reported
"No tracked work yet" while the adjacent chat was streaming tool calls. Chat
turns now surface from the durable `agent_runs` ledger, scoped to threads the
caller can access, and stopping one aborts the run instead of 404ing.
