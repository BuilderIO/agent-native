---
"@agent-native/core": patch
---

Copy `undici` into the server output for `node`, `node-server`, `koyeb`, and `render_com` builds, so Node server deployments can load SSRF protection. Serverless presets keep the existing external SSR package copy.
