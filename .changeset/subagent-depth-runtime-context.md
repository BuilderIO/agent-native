---
"@agent-native/core": patch
---

Surface the current sub-agent delegation depth in the runtime-context prompt.
The chat plugin now reads the ambient delegation depth and passes it into
`buildRuntimeContextPrompt`, so a sub-agent already at the delegation cap is
told it cannot spawn further sub-agents. The cap was already enforced
server-side; this only makes it visible to the model.
