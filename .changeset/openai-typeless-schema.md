---
"@agent-native/core": patch
---

Give type-less tool-schema positions a concrete JSON value union. OpenAI rejects
any schema position without a `type` ("schema must have a 'type' key") and 400s
the entire chat request, the same way it rejected `oneOf`. Zod emits a bare `{}`
for `z.unknown()`/`z.any()`, of which there are 137 sites across the templates,
so this is answered at the same boundary rather than by retyping every action.
