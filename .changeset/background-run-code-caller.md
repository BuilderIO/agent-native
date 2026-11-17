---
"@agent-native/core": patch
---

Background `run-code` executions now run as the caller that queued them, over the same network protocol, instead of as the app's own agent, so an outside agent's tool calls in one meet the same limits and approvals as in a foreground run.
