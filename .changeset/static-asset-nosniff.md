---
"@agent-native/core": patch
---

Send `X-Content-Type-Options: nosniff` on CDN-served static assets.

`/assets/**`, `/favicon.*`, `/manifest.json`, `/icon-*.svg`, and
`/library-presets/**` are served straight off the CDN, so the security-headers
h3 middleware never runs for them and they shipped without the `nosniff` header
that every function-served response already carries.
