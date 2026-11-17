---
"@agent-native/agentkit": patch
"@agent-native/core": patch
---

Keep a chat alive when it reconnects after its run moved on. Events for a run other than the subscribed one are now ignored instead of failing the stream, and reconnecting to a run whose early events were pruned now resumes from the earliest retained event instead of throwing.
