---
"@agent-native/core": patch
---

Carry `approvedToolCalls` through `agent-chat:submit` to the run config, so an app that resumes a paused `needsApproval` call from the browser has its grant consumed instead of the model asking for approval again. The resume is sent as a hidden protocol continuation. Inside a Builder frame a code-typed resume stays with the embedded app's chat instead of going to Builder's chat, which has no field for the keys and holds none of the app's grants.
