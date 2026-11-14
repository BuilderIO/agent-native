---
"@agent-native/core": patch
---

Copy external SSR runtime packages such as `undici` into the server output for `node`, `node-server`, `koyeb`, and `render_com` builds, so Node server deployments can load SSRF protection.
