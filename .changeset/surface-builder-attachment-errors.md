---
"@agent-native/core": patch
"@agent-native/dispatch": patch
---

Drop the caller-supplied `size` from Builder upload attachments and measure it on the server, reject invalid attachments up front with an `invalid_attachment` error, and teach the turn-into-app browser-host guide to attach Project instructions and knowledge files verbatim, so a bad or missing attachment no longer reads as a temporary Builder outage or a silent drop.
