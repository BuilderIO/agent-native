---
"@agent-native/core": minor
---

Add a shared link summary call between apps. `readPeerLinkSummaries` asks the app that owns a link what it is, as the signed-in reader, and `answerLinkSummaries` gives the owning app its side: the item's title only when that reader can open it, otherwise a bare `unavailable` that looks the same for a private, missing, or malformed link. A signed-out reader makes no call, and a refusal or a timeout (5 seconds by default) comes back as `unavailable` rather than an error. The shared types and link parsing are in `@agent-native/core/shared`.
