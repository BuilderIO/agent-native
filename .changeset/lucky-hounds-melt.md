---
"@agent-native/toolkit": patch
---

Memoize the composer runtime adapters context value so consumer effects stop
re-running on every provider render. The voice input preference was re-read from
app state, and the sidebar-state listener re-subscribed, once per render.
