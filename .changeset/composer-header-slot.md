---
"@agent-native/toolkit": patch
---

Add `composerHeaderSlot` to the agent chat, a row an app can put inside the message box above its context chips, and let `AgentSidebar` pass `composerHeaderSlot` and `hiddenComposerContextItemKeys` through. Export `AGENT_RESOURCE_CONTEXT_KEY`, the key of the chip that names the resource a scoped chat is open on. Editing and resending an earlier message now keeps the context items an app hides with `hiddenComposerContextItemKeys`, as a normal send already did.
