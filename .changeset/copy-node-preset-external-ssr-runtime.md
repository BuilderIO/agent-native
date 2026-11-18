---
"@agent-native/core": patch
---

Copy the `undici` version resolved from `@agent-native/core`'s dependencies into the server output for `node`, `node-server`, `koyeb`, and `render_com` builds under a dedicated `@agent-native/core-undici` path, so Core's SSRF protection keeps a compatible undici even when the app traced a different version into `node_modules/undici`. Serverless presets keep the existing external SSR package copy and pruning order.
