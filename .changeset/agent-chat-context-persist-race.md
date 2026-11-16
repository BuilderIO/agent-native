---
"@agent-native/core": patch
---

`setAgentChatContextItemAndPersist()` and `removeAgentChatContextItemAndPersist()` hold their change when a synchronous `setAgentChatContextItem()` publishes while their write is in flight. Before, the newer synchronous state hid the persisted change, so a composer prefill staged as the agent panel opened could vanish, and a removed one could stay. The change is now applied to that newer state, saved before the next queued write starts, and shown once saved, unless the synchronous change set the same key, or removed it or cleared the context. `setAgentChatContextItem()` and the other synchronous changes now save through the ordered app-state writer, so an earlier save can't reach the server after a later one and replace it.
