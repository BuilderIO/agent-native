---
"@agent-native/core": patch
---

Add an optional `sitemapGroup` to `buildAgentWebStaticFiles` and `createAgentWebVitePlugin` that splits `sitemap.xml` into a sitemap index with one `sitemaps/{group}.xml` per group, and teach `agent-native audit-agent-web` to follow a sitemap index to its first child sitemap.
