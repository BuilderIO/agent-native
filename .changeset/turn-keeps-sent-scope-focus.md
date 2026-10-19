---
"@agent-native/core": patch
---

Give each agent turn the chat scope `focus` its message was sent with. An app can set `focus` on its chat `scope` (for example, the open slide and selected elements), and the turn's actions read it from `getRequestRunContext()?.chatScope?.focus` even when the turn starts after the user has moved on, such as a queued or background turn.
