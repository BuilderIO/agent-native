---
"@agent-native/core": patch
---

Fix empty responses from non-Anthropic models (GPT-5.x, Gemini) on the Builder
gateway. Action tool schemas generated from `z.record(...)` emitted a
`propertyNames` JSON Schema keyword that OpenAI's function-calling validator
rejects with `400 invalid_function_parameters`, producing an empty assistant
turn. Tool schemas now strip `propertyNames` so they stay portable across
providers (Anthropic already ignored it).
