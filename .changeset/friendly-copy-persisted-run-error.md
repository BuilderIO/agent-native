---
"@agent-native/core": patch
---

Stop raw provider error text (a JSON error body, an SSL handshake failure) from
being persisted as the visible assistant reply. The server-side rebuild of an
assistant message (`buildAssistantMessage`, used by every background/durable
run, reconnect-after-disconnect, poller-triggered turn, and webhook-triggered
turn) appended `event.error` verbatim, unlike the live client which already
routes it through `normalizeChatError`/`formatChatErrorText` for friendly copy.
The rebuild now uses that same layer, so persisted text always matches what a
live client would have shown, and the raw diagnostic is kept only in
`runError.details`.
