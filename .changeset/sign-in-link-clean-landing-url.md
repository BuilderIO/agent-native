---
"@agent-native/core": patch
---

Signing in from an emailed link no longer leaves the used `token`, `callbackURL`, and `newUserCallbackURL` in the address bar. Netlify copies a request's query string onto any redirect whose `Location` has none, so the bare redirect after a verified link landed on the page with the sign-in query still attached. When a browser navigation to a sign-in or OAuth callback would get a bare redirect, it now gets a small no-store HTML page that replaces itself with the clean destination, keeping every session cookie and the app's base path. This covers Better Auth callbacks, the new-user callback, Google OAuth completion, identity SSO, workspace connection OAuth, and MCP server OAuth. `queryEchoSafeRedirect` is exported from `@agent-native/core/server` for app-owned callbacks. API clients still get the redirect, and an expired or used link still lands with its `?error=` code.
