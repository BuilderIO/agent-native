---
"@agent-native/core": patch
---

`setAgentChatContextItemAndPersist()` and `removeAgentChatContextItemAndPersist()` hold their change when a synchronous `setAgentChatContextItem()` publishes while their write is in flight. Before, the newer synchronous state hid the persisted change, so a composer prefill staged as the agent panel opened could vanish, and a removed one could stay. The change is now applied to that newer state, saved before the next queued write starts, and shown once saved, unless the synchronous change set the same key, or removed it or cleared the context. `setAgentChatContextItem()` and the other synchronous changes now save through the ordered app-state writer, so an earlier save can't reach the server after a later one and replace it.

`writeClientAppState()` takes a new `ownRequest` option, which sends the value in a request of its own, as a write with an abort `signal` already is. Without it, a write still waiting behind an earlier one takes the value of a later write to the same key. The persisted context functions use it, so a synchronous save made while their write waits can no longer replace what they save. A keepalive write sent this way still goes out when the page hides, as a queued one does, unless a compare-and-set or a signalled write is ahead of it.
