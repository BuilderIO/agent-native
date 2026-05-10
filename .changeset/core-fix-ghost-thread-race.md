---
"@agent-native/core": patch
---

fix(chat): stop the ghost-thread race between the client's optimistic thread create and the agent run's `persistSubmittedUserMessage`. Three matching changes:

- `useChatThreads` no longer synthesizes a fresh UUID inside `useState` on first mount — that was racing with the server-side create and producing thread ids that disappeared from history when threads loaded.
- The per-thread `localStorage` cache (`agent-chat-thread-cache:*`) is removed; it only papered over the ghost-thread state, and the server fetch is fast and authoritative.
- `POST /_agent-native/agent-chat/threads` is now idempotent: if a row with the supplied id already exists for this owner it's returned instead of 500'ing on the UNIQUE constraint, and lost create races re-fetch the landed row before rethrowing.
