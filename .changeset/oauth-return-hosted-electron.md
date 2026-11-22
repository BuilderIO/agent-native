---
"@agent-native/toolkit": patch
---

Google sign-in from a hosted app in an Electron browser, such as T3 Code's, now returns to the app instead of a local address (127.0.0.1:8080). The automatic desktop gateway fallback only applies when the page itself is served from a loopback address; a configured workspace gateway return still applies as before.
