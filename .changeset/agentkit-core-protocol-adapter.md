---
"@agent-native/core": patch
---

Add a formal headless AgentKit adapter and Agent-Native transport over Core's
existing runtime, durable thread history, and queue storage. Preserve rich event
contracts and capability metadata, serialize queued-message writes, restore
failed promotions, and expose per-thread execution and response lifecycle state.
