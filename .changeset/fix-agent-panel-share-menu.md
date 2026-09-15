---
"@agent-native/core": patch
---

Fix the "Share" item in the agent chat sidebar overflow menu silently doing
nothing. It used the `requestAnimationFrame` overlay-open handoff by default,
which races with the dropdown menu's own close/focus-restore cycle for a
freshly-mounted popover — the same failure mode fixed for "All chats" in
#4644. Share now uses the `"timeout"` handoff timing so the share popover
reliably opens.
