---
"@agent-native/core": minor
---

Add Firecrawl integration across the two agent web tools, gated on `FIRECRAWL_API_KEY`:

- **web-search**: Firecrawl joins the pluggable BYOK backend chain (Brave → Tavily → Exa → Firecrawl → Builder-managed), routing searches through Firecrawl's `/v2/search` API.
- **web-request**: a new `render:true` option (GET only) fetches a fully-rendered page through Firecrawl's `/v2/scrape` API before extraction. This handles JavaScript-rendered SPAs and anti-bot-protected pages that a plain header-spoofed `fetch` returns empty or blocked. The rendered HTML flows through the existing extraction pipeline, so all `responseMode`/`search`/`links`/`saveToFile` behavior is unchanged.

`FIRECRAWL_API_KEY` is registered as an optional framework secret so it surfaces in every template's settings UI, mirroring the existing Brave/Tavily/Exa registrations.
