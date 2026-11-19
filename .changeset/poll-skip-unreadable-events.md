---
"@agent-native/core": patch
---

Polling no longer stalls when apps share one sync events table. A change for a resource type the polling app never registered is now hidden on the batch access check too, not only on the single one, so the first read on a fresh server no longer answers 409 for every user. An event the server still can't check or parse is skipped instead of failing the whole read: the response lists it under `unreadable`, the server logs it and counts it in `agent_native.sync.unreadable_events`, and the tab refreshes its data once and keeps polling from past it.
