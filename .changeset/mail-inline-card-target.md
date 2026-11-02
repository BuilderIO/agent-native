---
"@agent-native/core": patch
---

An app can name a tool's card as an embed target without exposing a directory route, by setting `directoryRoute: false` on its `directoryProfile`. Embeds that run in place, the way Claude shows them, now load and keep saving: the shell asks for the app page as HTML, sends a write's body as bytes rather than as a stream, and renews an expired session through the host.
