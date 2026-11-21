---
"@agent-native/core": patch
---

An app can now keep the chats of quiet background runs out of the person's chat history. Pass `historyHiddenScopeTypes` to `createAgentChatPlugin` with the scope types those runs use, and the chat list and chat search leave them out unless a request asks for that scope. Opening one of those chats by id still works, so a "show in chat" link keeps working. The thread store's `listThreads` and `searchThreads` take the matching `excludeScopeTypes` option.
