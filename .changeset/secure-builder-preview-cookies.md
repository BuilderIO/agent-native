---
"@agent-native/core": patch
---

Keep sign-in working inside Builder preview iframes: session, embed, and UI-capability cookies (and Better Auth's session cookie) now use `SameSite=None; Secure; Partitioned` when a dev server is served through Builder's HTTPS preview tunnel, and HTTPS detection lives in one shared helper.
