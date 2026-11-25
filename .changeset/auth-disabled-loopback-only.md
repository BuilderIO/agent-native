---
"@agent-native/core": patch
---

Log an error at startup when `AUTH_DISABLED` is set on a production server or on a dev server published on a public preview URL, and let `AGENT_NATIVE_DEV_HOST` pin the dev server's bind address. The Desktop app now binds the apps it runs with sign-in off to `127.0.0.1`, and the docs describe `AUTH_DISABLED` as local development on loopback only.
