---
"@agent-native/core": patch
"@agent-native/toolkit": patch
---

A fresh server no longer loads React DOM's server renderer, the sign-in pages and their icon set before it can answer a request. `createToolkitAuthPlugin` loads them before the first page request instead: any GET outside the app's framework routes, or a browser navigation. It reads each path as the auth guard does, with `getAuthGuardPath`, which core now exports from `@agent-native/core/server/auth-guard-path`. The server's agent-presence code no longer imports React. `renderSignInPage` and `renderResetPasswordPage` may now return `undefined`, which serves core's fallback markup for the auth client script to render in the browser. An app that passes the toolkit's `renderAuthPage` to core's `createAuthPlugin` itself should `await loadAuthPageRenderers()` before serving a sign-in page, or it gets that fallback. `createGoogleAuthPlugin` now renders its sign-in page for each request that shows it, rather than once at startup, so a renderer that loads later still reaches the page.
