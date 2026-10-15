---
"@agent-native/core": patch
---

Send the Builder connect popup and its OAuth callback to the app's declared public origin (`APP_URL` and friends) when a proxy rewrites `Host` to a platform hostname such as `*.netlify.app`, so Builder Cloud-hosted apps no longer open the connect flow on their blocked Netlify URL.
