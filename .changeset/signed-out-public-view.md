---
"@agent-native/toolkit": patch
---

`RequireSession` and `AppProviders` take a `signedOutHref` callback, so an app can send a signed-out visitor to a public view of the current URL instead of sign-in.
