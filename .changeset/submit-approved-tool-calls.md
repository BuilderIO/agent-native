---
"@agent-native/core": patch
---

Carry `approvedToolCalls` through `agent-chat:submit` to the run config, so an app that resumes a paused `needsApproval` call from the browser has its grant consumed instead of the model asking for approval again. The resume is sent as a hidden protocol continuation. Inside a Builder frame or an MCP App embed the resume stays with the app's own chat, which owns the paused run; neither Builder's chat nor the MCP host's chat can carry the keys.
