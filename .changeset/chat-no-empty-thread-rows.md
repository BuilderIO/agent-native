---
"@agent-native/core": patch
---

fix(chat): stop creating empty `chat_threads` rows for users who never send a message. The client used to optimistically `POST /_agent-native/agent-chat/threads` on mount and on every "+" click, which inflated the table with rows that had `message_count=0` and zero linked `agent_runs` (one user's account had 112 such ghost rows out of 127 total). The server already creates the row idempotently when the user actually sends — `persistSubmittedUserMessage` → `createThread` — so the client now only adds the thread to its local list and skips the POST. The threads table reflects real conversations only.
