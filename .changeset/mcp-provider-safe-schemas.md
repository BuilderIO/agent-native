---
"@agent-native/core": patch
---

Advertise MCP tool input schemas that Anthropic, OpenAI and Gemini all accept: composed roots (`anyOf`, `oneOf`, `allOf`) are flattened into one object, and hand-written JSON schemas get the same keyword stripping as Zod schemas. Actions still validate calls against their own schema.
