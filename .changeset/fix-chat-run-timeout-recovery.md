---
"@agent-native/core": patch
---

Auto-continue recoverable chat run timeouts during reconnect without showing the internal resume prompt in chat history, and retry transient `ask_app_status` bridge fetch failures before surfacing an error.
