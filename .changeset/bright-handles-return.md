---
"@agent-native/core": patch
---

Keep asynchronous `ask_app` task handles and exact polling arguments visible to MCP callers so they can retrieve the same cross-app task without resubmitting it.
