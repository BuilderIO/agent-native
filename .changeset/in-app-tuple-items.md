---
"@agent-native/core": patch
---

Give every array in an in-app agent tool schema an `items` schema, as MCP already does. A `z.tuple` field (only `prefixItems`) made OpenAI reject the whole request with "array schema missing items", so Design chats that loaded `edit-native-shader` failed on every retry.
