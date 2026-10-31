---
"@agent-native/core": patch
"@agent-native/toolkit": patch
---

A fresh server no longer loads React DOM's server renderer, the sign-in pages and their icon set before it can answer a request. `createToolkitAuthPlugin` loads them on the first page navigation instead, and the server's agent-presence code no longer imports React. `renderSignInPage` and `renderResetPasswordPage` may now return `undefined`, which serves core's fallback markup for the auth client script to render in the browser. An app that passes the toolkit's `renderAuthPage` to core's `createAuthPlugin` itself should `await loadAuthPageRenderers()` before serving a sign-in page, or it gets that fallback.
