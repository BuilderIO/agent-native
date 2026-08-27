---
"@agent-native/core": patch
---

Preserve a trailing slash in advertised agent-web page URLs. `normalizePagePath` stripped it from every page path, so a site whose canonical URLs carry a trailing slash had every sitemap entry, `llms.txt` link, and JSON-LD `url` pointing at a redirect instead of the page. Bare page paths are unchanged, and Markdown twin paths still drop the route's trailing slash (`/about/` → `/about.md`).
