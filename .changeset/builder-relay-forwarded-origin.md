---
"@agent-native/core": patch
---

Fix Builder preview credential relay failing behind a proxy. The relay handler now derives the request origin from `x-forwarded-host`/`x-forwarded-proto` (via `getBuilderBrowserOriginForEvent`) instead of the internal loopback host, so `targetOrigin` verification passes on hosted preview deployments.
