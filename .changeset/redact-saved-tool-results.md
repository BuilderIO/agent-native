---
"@agent-native/core": patch
"@agent-native/dispatch": patch
---

Successful tool results are redacted before they are streamed and saved to a thread, so credential fields and `?token=` style values no longer reach people a thread is shared with. `web-request` no longer returns a substituted key inside the links it extracts from a page, and Dispatch's `create-link-token` result is kept out of saved chat history.
