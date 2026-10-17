---
"@agent-native/core": patch
---

Add `refreshOnThreadUpdates` to `useChatThreadList()` so callers can disable thread update event refreshes while retaining initial loading, manual refresh, and paging.
