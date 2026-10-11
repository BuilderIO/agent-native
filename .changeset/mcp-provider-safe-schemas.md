---
"@agent-native/core": patch
---

Advertise MCP tool input schemas that pass the Anthropic, OpenAI and Gemini schema rules Core pins. A root `anyOf`, `oneOf` or `allOf` is flattened into one object, and the schema description lists the argument sets it combined. Hand-written JSON schemas get the same keyword stripping as Zod schemas. Every rewrite only widens what the schema accepts, and actions still validate calls against their own schema.
