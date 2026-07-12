---
"@agent-native/core": patch
---

Fixed a bug where a long-running background agent turn could flip the chat to a finished state mid-turn: if the client re-polled a chunk's terminal run row before its server-chained successor became visible, it now keeps following instead of prematurely completing the message. Background runs that die between chunks now get a short grace window to recover onto a claimable successor before surfacing an error, and the "Resuming…" indicator stays warm while the client waits, so the UI never drops into a false-idle state during the handoff.
