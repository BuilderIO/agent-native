---
"@agent-native/core": patch
"@agent-native/toolkit": patch
---

Two fixes for hiding shared chats. When the server refuses a hide, `useChatThreadList` now always fetches the list again. Before, a list with `includeHidden` kept showing a chat whose access was revoked while the request was out, until its next refresh. In the toolkit's chat history, a hide that fails after you switch views or close the list now replaces the "Hidden" toast with the error. Before, the toast kept saying the chat was hidden.
