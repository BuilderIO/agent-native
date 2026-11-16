---
"@agent-native/core": patch
---

Copy the `undici` version resolved from `@agent-native/core`'s dependencies into the server output for `node`, `node-server`, `koyeb`, and `render_com` builds, so Node server deployments can load SSRF protection. Serverless presets keep the existing external SSR package copy and pruning order.
