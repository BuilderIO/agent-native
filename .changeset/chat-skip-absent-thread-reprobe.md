---
"@agent-native/core": patch
---

Chat: stop re-probing the server for a thread that already returned 404. The
mount-time restore effect now caches known-absent thread ids for the page
session, so navigating between routes no longer re-spams
`GET /_agent-native/agent-chat/threads/:id` with 404s for a freshly created,
not-yet-sent chat. Behavior is unchanged otherwise — a missing thread still
falls back to an empty chat.
