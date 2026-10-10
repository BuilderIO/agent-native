---
"@agent-native/core": patch
---

Fix ChatGPT directory widgets (Slides, Design, Content) showing "Embedded app session expired" with a Retry button that never recovers after the chat is reloaded or the widget is opened after its short-lived start ticket lapsed. The widget shell ignored the server's expiry notice in directory mode, so it never asked the start tool for a new session. It now renews from the saved widget source ticket, and a start URL the server has already refused is no longer relaunched when the host re-syncs.
