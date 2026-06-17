---
"@agent-native/core": minor
"@agent-native/dispatch": minor
---

Add token-efficient web content fetching for agents. `web-request` and `provider-api-docs` can now return extracted markdown, plain text, metadata, links, or bounded search matches instead of raw HTML, and `run-code` exposes `webRead()` plus pass-through options on `webFetch()` for compact web/document reduction.
