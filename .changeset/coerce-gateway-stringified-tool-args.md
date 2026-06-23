---
"@agent-native/core": patch
---

Coerce stringified action arguments before validation. This fixes two cases that both arrive at the validator as strings:

- **`useActionQuery` / `callAction` GET calls.** Browser query params are serialized through `URLSearchParams`, which stringifies everything — so `useActionQuery("instrument-overview", { includeSeries: true })` sent `includeSeries: "true"` and a schema expecting `z.boolean()` rejected it with "expected boolean, received string". Numbers had the same problem (`limit: 5` → `"5"`).
- **Gateway-stringified tool args.** Some model gateways (notably Builder's Gemini-backed gateway) hand structured tool-call arguments back as JSON strings — an array param arrives as `"[{...}]"`, a boolean as `"true"` — so the agent could thrash retrying shapes (and hang).

The validation wrapper now coerces a string value to the type its schema field declares (array/object via `JSON.parse`, boolean, number/integer) when — and only when — the schema expects a non-string type and the string parses cleanly to it; ambiguous or unparseable values are left untouched so the normal validation error still surfaces.
