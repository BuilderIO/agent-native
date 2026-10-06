---
"@agent-native/core": patch
---

Signing in from an emailed link no longer leaves the used `token`, `callbackURL`, and `newUserCallbackURL` in the address bar. Netlify copies a request's query string onto any redirect whose `Location` has none, so the bare redirect after a verified link landed on the page with the sign-in query still attached. When a browser navigation to a sign-in callback would get a bare same-origin redirect, it now gets a small no-store HTML page that replaces itself with the clean destination, keeping every session cookie. This covers Better Auth callbacks, the new-user callback, Google OAuth completion, and identity SSO. API clients still get the redirect, and an expired or used link still lands with its `?error=` code.
