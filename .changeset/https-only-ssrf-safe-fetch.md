---
"@agent-native/core": patch
---

`ssrfSafeFetch` hardening: a new `httpsOnly` option validates the URL scheme on the initial request and on every redirect hop, so HTTPS-only callers cannot be downgraded to plain HTTP by a redirect from the untrusted origin. Followed redirect responses now also have their bodies cancelled so each hop's connection is released immediately instead of being held until GC.
