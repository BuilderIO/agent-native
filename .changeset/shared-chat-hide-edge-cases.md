---
"@agent-native/core": patch
"@agent-native/toolkit": patch
---

Fixes for hiding shared chats that fail. When the server refuses a hide, `useChatThreadList` and the toolkit's chat history now fetch the list again. Before, a chat whose access was revoked while the request was out came back and stayed listed until the next refresh. In the toolkit's chat history, a hide that fails after you switch views or close the list now replaces the "Hidden" toast with the error. Before, the toast kept saying the chat was hidden.
