---
"@agent-native/core": patch
---

Export `hasSessionHint()` from `@agent-native/core/client/use-session`, so an app can start a read that needs a signed-in visitor alongside the session check instead of after it. It reads the same cookie, with the same rule, as the early session read.

Also export `isSessionFromFirstRead()`, which says whether the session the tab holds answered the page load's own session read. A read started before the session was known carried the same cookies only while it holds; after a retry or an invalidation, another tab may have switched accounts, so the app should drop that read rather than show it.
