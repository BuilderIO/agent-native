---
"@agent-native/core": patch
---

Add an `httpsOnly` option to `ssrfSafeFetch` that validates the URL scheme on the initial request and on every redirect hop, so HTTPS-only callers cannot be downgraded to plain HTTP by a redirect from the untrusted origin.
