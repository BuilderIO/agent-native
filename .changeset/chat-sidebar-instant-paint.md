---
"@agent-native/core": patch
---

Make the chat sidebar paint the composer immediately on open instead of blocking behind a `GET /threads` (+ optional `POST /threads`) round-trip. `useChatThreads` now seeds an optimistic active thread synchronously on mount — either from localStorage or a freshly-generated UUID — and persists it server-side in the background. For new chats the empty/composer state is visible on first render; for existing chats the header and composer render immediately while the per-thread restore skeleton stays scoped to the message area.
