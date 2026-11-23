---
"@agent-native/dispatch": patch
"@agent-native/toolkit": patch
---

Prevent a late thread snapshot save or stale thread URL sync from navigating back to `/chat/<threadId>` after the user or agent has already navigated away from `/chat` (for example to `/apps`).
