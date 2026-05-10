---
"@agent-native/core": patch
---

fix(chat): recover from chats disappearing from sidebar history

Two changes that together restore the pre-#621 behavior where the chat history list always reflects the server:

- **client**: Stop hydrating chat messages from a per-thread `localStorage` cache, and stop synthesizing a fresh UUID active thread inside the `useState` initializer. The cache could mask stale or partially-saved threads, and the synthesized id raced with the agent run's server-side `persistSubmittedUserMessage` create — when the client's `POST /threads` then lost the race, its `.catch` was yanking the freshly-created thread out of local state. Active thread is now resolved against the server's threads list (most-recent fallback if the saved id isn't there); thread messages are loaded from the server. The `agent-chat-active-thread` localStorage key still persists which thread the user last had focused.

- **server**: Make `POST /_agent-native/agent-chat/threads` idempotent. When the request body's `id` matches an existing thread owned by the same user, return that thread instead of failing on the SQL UNIQUE constraint. This also means a flaky network retry of `POST /threads` no longer 500s after the agent's `onRunPrepared` already inserted the row.
