---
"@agent-native/core": patch
---

`setAgentChatContextItemAndPersist()` keeps its item when a synchronous `setAgentChatContextItem()` publishes while the write is in flight. Before, the newer synchronous state hid the persisted item, so a composer prefill staged as the agent panel opened could vanish. The item is now added to that newer state and saved, unless the synchronous change set or removed the same key.
