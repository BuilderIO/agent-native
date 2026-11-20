---
"@agent-native/core": patch
---

Approving a paused tool call now requires the call's pending ask id (`approvedToolCallAskIds`) alongside its key, and `agentNative.submitChat` carries `approvedToolCalls` only when the message comes from the app's own origin.
