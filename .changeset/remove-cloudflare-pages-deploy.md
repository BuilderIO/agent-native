---
"@agent-native/core": patch
---

Remove Cloudflare Pages from workspace deploy and the standalone build. `agent-native deploy` now defaults to Netlify and accepts only `netlify` or `vercel`. `NITRO_PRESET=cloudflare_pages` fails like any unsupported preset. Standalone Cloudflare Workers stays on `cloudflare_module`.
