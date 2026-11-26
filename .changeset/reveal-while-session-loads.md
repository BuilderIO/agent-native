---
"@agent-native/toolkit": patch
---

Add `revealWhileLoading` to `AppProviders` and `RequireSession` so an app can show its already-mounted tree, instead of the skeleton, while the session read is in flight. It is asked once per load, only applies when a session hint is present, keeps the tree mounted when the session resolves, and a signed-out or unreadable session still takes the app down as before.
