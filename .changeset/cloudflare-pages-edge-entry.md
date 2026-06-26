---
"@agent-native/core": patch
---

Avoid pulling Node-only server exports into Cloudflare Pages worker bundles and upload pre-bundled Pages workers without Wrangler re-bundling.
