---
"@agent-native/core": patch
"@agent-native/agentkit": patch
---

Clear shared chat composers when AgentKit owns the recoverable user message instead of waiting for the agent request to start. Preserve newer drafts, explicit send failures, and queued-message acknowledgement timing without sending local callbacks to transports or persisted submissions.
