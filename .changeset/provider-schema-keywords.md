---
"@agent-native/core": patch
---

Drop JSON Schema keywords OpenAI's function validator rejects: unsupported
`format` values (`uri` from `z.string().url()` among them) and constraint-only
keywords like `patternProperties`, `not`, and `if`/`then`/`else`. Any one of them
400s the entire chat request, so a single `z.string().url()` in one tool broke
every turn that offered it.
