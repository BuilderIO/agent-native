---
"@agent-native/core": minor
"@agent-native/toolkit": minor
---

Turn MCP Apps cards on by default. A chat app signed in as a person through the app's own OAuth sign-in (as Claude and ChatGPT are) or a connect token, with write access, now gets cards without turning anything on, and the "App cards in chat apps" lab is gone from Settings → Labs. A card can open the whole app, so other connections get plain results with links: a read-only connection, a shared `ACCESS_TOKEN` (even with `AGENT_NATIVE_OWNER_EMAIL` set), an A2A token, a standalone stdio server, or a service principal. The ChatGPT app-directory catalog and first-party clients are unchanged. A chat app connected while the lab was off may keep its old tool list until it is reconnected. The retired `AGENT_NATIVE_MCP_APPS_INLINE` and `AGENT_NATIVE_MCP_APPS_INLINE_ALLOW_EMAILS` variables still do nothing; a mounted MCP server logs one warning at startup if either is set.
