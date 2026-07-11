---
"@agent-native/core": patch
---

Archived chat threads are now excluded from thread lists and search by default, so archiving a thread actually removes it from the sidebar/history and the `chat-history` agent tool. Pass `includeArchived: true` (store options, `chat-history` search action, or `search-chats` script) to see archived threads explicitly.
