---
"@agent-native/core": patch
---

Preserve a trailing slash in advertised agent-web page URLs. `normalizePagePath` stripped it from every page path, so a site whose canonical URLs carry a trailing slash had every sitemap entry, `llms.txt` link, and JSON-LD `url` pointing at a redirect instead of the page. Bare page paths are unchanged, and Markdown twin paths still drop the route's trailing slash (`/about/` → `/about.md`). JSON-LD breadcrumb items now follow the page's own URL shape.

Add an optional `localizeHref` to `BlockRenderContext`. Block fields such as a card `href` go straight to the router without passing through `renderMarkdown`, so a host that canonicalizes its URLs had no way to reach them.
