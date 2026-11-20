---
"@agent-native/dispatch": patch
---

`open_app` takes an `intent` in the user's words and picks the app itself when `app` is not given. An explicit `app` still wins, and a request that routes to no app returns a clear error instead of opening anything.
