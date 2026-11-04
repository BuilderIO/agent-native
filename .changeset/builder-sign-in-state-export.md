---
"@agent-native/core": patch
---

Export `resolveBuilderOAuthRequestAccessState` and its `BuilderOAuthRequestAccessState` type from `@agent-native/core/server`, so an app's readiness check can tell a saved Builder.io sign-in this deployment cannot decrypt (`unreadable`) from no sign-in (`not_connected`) instead of reading both as "not connected".
