---
"@agent-native/core": patch
---

Fix Google sign-in popup showing "[object Object]" instead of redirecting to Google. The `/_agent-native/google/auth-url?redirect=1` path used h3 v2's `sendRedirect`, which (in `2.0.1-rc.20`) ignores the event and returns a non-standard `HTTPResponse` instance; the request-handler shim stringified it to `[object Object]` with a 200 status and no `Location` header. It now returns a native web `Response` 302, matching the proven OAuth response idiom used by the callback route.
