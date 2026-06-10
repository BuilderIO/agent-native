---
"@agent-native/core": minor
---

Add connector-catalog tier for hosted multi-tenant MCP deployments.

When `AGENT_NATIVE_CONNECTOR_CATALOG=1` is set and a template declares a `connectorCatalog` in `createAgentChatPlugin` options, external MCP clients see only the declared action allow-list plus the four builtin cross-app tools (`list_apps`, `open_app`, `ask_app`, `create_embed_session`). Calls to tools outside the list are rejected. Individual callers can opt up to the full surface by minting their token with `agent-native connect --full-catalog`, which embeds a `catalog_scope: "full"` claim in the JWT. Local and dev deployments without the env flag are unaffected. The plan template declares its curated connector catalog covering plan CRUD, sharing, upload, navigation, automations, and tool-search while excluding db-exec, seed-\*, extension tools, browser-session tools, and context-xray internals.
