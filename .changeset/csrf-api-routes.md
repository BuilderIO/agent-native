---
"@agent-native/core": patch
---

The same-origin check on cookie-bearing writes compares the request's media type exactly and now also covers template `/api/*` routes. Form-style bodies (`text/plain`, `multipart/form-data`, `application/x-www-form-urlencoded`) need `Sec-Fetch-Site: same-origin` or the `X-Agent-Native-CSRF` header.
