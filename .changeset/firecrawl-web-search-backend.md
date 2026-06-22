---
"@agent-native/core": minor
---

Add Firecrawl as a BYOK backend for the web-search agent tool. When `FIRECRAWL_API_KEY` is configured (via app secrets or environment) the tool routes searches through Firecrawl's `/v2/search` API. It slots into the existing first-configured-wins chain after Brave, Tavily, and Exa, and before Builder-managed search, and is registered as an optional framework secret so it surfaces in every template's settings UI.
