---
"@agent-native/core": patch
---

Advertise MCP tool input schemas that pass the Anthropic, OpenAI and Gemini schema rules Core pins. A root `anyOf`, `oneOf` or `allOf` is flattened into one object, and the schema description lists the argument sets it combined. Hand-written JSON schemas get the same keyword stripping as Zod schemas. A typeless `const` or `enum` gets an explicit type taken from its values, so Codex no longer narrows `{ "const": 1 }` to a string. A string `const` is advertised as a one-value `enum`, which Gemini honors, and `maxItems` moves into the description, because Gemini refuses a forced call to a large bounded array. Every rewrite only widens what the schema accepts, and actions still validate calls against their own schema.

A schema reference that does not resolve now fails with a named error instead of disappearing when its branch is flattened. References spelled as encoded pointers or `$anchor` names are rewritten to plain pointers first; an `$id` below the root, a non-local `$ref` and `$dynamicRef` are refused. The in-app agent skips such a tool with a warning instead of failing the turn.
