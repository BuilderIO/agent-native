---
"@agent-native/core": patch
---

The Design localhost bridge no longer exits when a proxied WebSocket connection is reset by the browser or the dev server; the daemon used to die with `read ECONNRESET` minutes after a visual-edit frame reloaded.
