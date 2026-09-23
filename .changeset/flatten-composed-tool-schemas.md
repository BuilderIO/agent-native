---
"@agent-native/core": patch
---

Flatten a tool input schema with a top-level `anyOf`/`oneOf`/`allOf` into one object schema before it reaches the provider. An action whose Zod schema is a union compiled to a root `anyOf`, which the AI SDK engines forwarded unchanged and Anthropic rejects for the whole request; the native Anthropic translator dropped the composition and left the model with no parameters. Both translators now merge every branch's properties at the root (a property the branches declare differently becomes an `anyOf` of its variants) and require only the keys every `anyOf`/`oneOf` branch requires, or every key an `allOf` branch requires.
