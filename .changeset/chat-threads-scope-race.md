---
"@agent-native/core": patch
---

Fix race condition in `useChatThreads` that dropped the active general chat when the user navigated into a scoped resource before `GET /threads` resolved. The scope-flip rehydration effect now defers the decision when thread metadata is unknown (instead of falling through and swapping to the scoped storage key), so the visible conversation is preserved until threads load and a real decision can be made.
