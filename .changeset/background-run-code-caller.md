---
"@agent-native/core": patch
---

Background `run-code` executions now run as the caller that queued them, over the same network protocol, and a background data-program run that an outside caller started keeps that caller. Before, both ran as the app's own agent, so an outside agent's tool calls in them skipped the limits and approvals of a foreground run.
