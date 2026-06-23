---
"@agent-native/core": patch
---

Coerce gateway-stringified tool arguments before action validation. Some model gateways (notably Builder's Gemini-backed gateway) hand structured tool-call arguments back as JSON strings — an array param arrives as `"[{...}]"`, a boolean as `"true"`. Standard Schema (zod) validation does not coerce, so these calls failed validation and the agent could thrash retrying different shapes (and hang). The validation wrapper now coerces a string value to the type its schema field declares (array/object via `JSON.parse`, boolean, number/integer) when — and only when — the schema expects a non-string type and the string parses cleanly to it; ambiguous or unparseable values are left untouched so the normal validation error still surfaces.
