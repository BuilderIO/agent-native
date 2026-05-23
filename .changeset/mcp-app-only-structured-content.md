---
"@agent-native/core": patch
---

Fix MCP App embed regression: `create_embed_session` (and any tool with `_meta.ui.visibility: ["app"]`) now surfaces its raw result via `structuredContent` so the embed iframe can read the mint `startUrl`.

Without this, PR #875's text-side embed-URL purge stripped the embed start URL from the only fallback the iframe had, breaking the "open inline" flow with "This app can be opened, but not embedded from this MCP server." Compliant hosts already honor the `visibility: ["app"]` hint and keep the tool result out of the LLM transcript; the structuredContent path is safe for these tools.
