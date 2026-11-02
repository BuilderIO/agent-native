---
"@agent-native/core": patch
---

Give every array in an in-app agent tool schema an `items` schema, as MCP already does. A `z.tuple` field (only `prefixItems`) made OpenAI reject the whole request with "array schema missing items", so Design chats that loaded `edit-native-shader` failed on every retry.

`@agent-native/core/testing` adds `listAgentToolSchemas`, `AGENT_PATH_PROVIDERS`, and `listAgentTools()` on `loadTemplateMcpConformance`, so a template spec can hold its in-app agent tools to the Anthropic and OpenAI rules as well as its MCP catalogs.
