---
"@agent-native/core": patch
---

Log an error at startup when `AUTH_DISABLED` is set on a production or hosted server, or on a dev server published on a public preview URL. The Vite dev server now binds to `127.0.0.1` by default while `AUTH_DISABLED` is on, unless the app sets `server.host`. Every reader of `AUTH_DISABLED` now accepts the same values (`1` or `true`), and the docs describe it as local development on loopback only.
