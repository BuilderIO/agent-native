---
"@agent-native/core": minor
"@agent-native/dispatch": patch
---

Add an authenticated, nonce-only completion route for packaged Desktop clients orchestrating cross-app identity federation.

Ensure Dispatch installs identity federation routes on its primary auth guard so concurrent Nitro plugin startup cannot pre-empt them with a 401.
