---
"@agent-native/core": patch
---

Copy external SSR runtime packages such as `undici` into the server output for `node` and `node-server` builds, so self-hosted deployments can load SSRF protection.
