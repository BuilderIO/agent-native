---
"@agent-native/core": patch
---

Keep SSR HTML and React Router data responses CDN-cacheable across auth-looking requests, and publish a default no-op Speculation-Rules header to prevent Cloudflare Speed Brain prefetch refusals from surfacing as 503s.
