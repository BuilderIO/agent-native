---
"@agent-native/core": patch
---

Make the chat sidebar paint instantly on open instead of blocking behind network round-trips. `useChatThreads` now seeds an optimistic active thread synchronously on mount — either from localStorage or a freshly-generated UUID — and persists it server-side in the background. For existing chats, every save also writes the thread data to a localStorage cache, and `AssistantChat` hydrates from that cache synchronously so the message bubbles paint on first commit; the server fetch still runs in the background to refresh, and is skipped as a no-op when the server data is identical to the cache.
