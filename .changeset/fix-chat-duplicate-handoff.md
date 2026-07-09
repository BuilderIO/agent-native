---
"@agent-native/core": patch
---

Fix duplicate in-progress chat output during reconnect handoff so streaming text and tool calls render once while the live assistant message catches up. Also stop a reconnect tool spinner from rendering a second card beside its live pending tool card when their reader-local and server-scoped ids don't match, in every reconnect/handoff window.
