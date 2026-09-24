---
"@agent-native/core": minor
---

Add `anonymousApplicationState` to `createCoreRoutesPlugin`. When enabled, `/_agent-native/application-state` scopes a request without a session to the `anonymousOwner` the app resolves, instead of answering 401, so a guest chat's navigation, URL and composer preference sync works for anonymous visitors. Off by default.
