---
"@agent-native/core": patch
---

Add `isLoopbackRequest` to the request context and a `getRequestIsLoopback()` reader. The action-route handler captures the real socket peer (via `getRequestIP` without `x-forwarded-for`, so headers cannot spoof it) while the h3 event is still in scope, letting code below the HTTP layer distinguish a local-dev caller from a remote one. Used by Design to let `/visual-edit` work without a login on a localhost-backed design while keeping remote viewers read-only.
