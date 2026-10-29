---
"@agent-native/core": patch
---

Mark the `agentNative.chatRunning` event for a run this client just started with `reason: "run.submitted"`, so apps can follow a submitted message's run without a successor link. `readAgentRunStatus` also reports `awaitingRedispatch` when a run is waiting for its continuation.
