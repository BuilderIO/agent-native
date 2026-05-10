---
"@agent-native/core": patch
---

fix(chat): stop creating empty `chat_threads` rows on every page mount + recover from stale active threads

Two related fixes that together prevent `chat_threads` from filling up with ghost rows and prevent users from getting stuck on an active id the server doesn't know about:

- `useChatThreads` no longer optimistically `POST`s `/_agent-native/agent-chat/threads` when synthesizing a thread id for the composer. The previous flow inserted an empty `chat_threads` row (`message_count=0`, no linked `agent_runs`) on every page mount and every "+" click, even when the user never sent a message. The agent run's server-side `persistSubmittedUserMessage` already creates the row idempotently the moment the user sends, so the client just adds the thread to local state. Rows now land in `chat_threads` only when there's a real conversation behind them.
- When the saved active thread id isn't on the server AND wasn't created locally this session, the hook now drops the user on the most-recent real thread instead of leaving them on a stale composer that the server has no record of. The `newlyCreatedRef` check disambiguates: only optimistic-this-session ids stay active; ids from a previous session whose row was cleaned up get swapped out.

Per-thread merge in `fetchThreads` (already shipped) keeps in-flight optimistic threads visible until the server learns about them, so the chat list still shows the user's current thread without flicker.
