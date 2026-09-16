---
"@agent-native/core": patch
---

Fix the shared agent-chat error card (`RunErrorRecoveryCard`) letting long,
unbroken error text (such as raw provider JSON payloads) overflow past the
card's bounds in the side-panel chat. The message paragraph now wraps with
`break-words`/`whitespace-pre-wrap` and the card allows itself to shrink with
`min-w-0`, matching the wrapping already used by the inline turn-marker error
detail. This is the one shared component every template's AI side panel
(Mail, Calendar, and others) renders run errors through.
