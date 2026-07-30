---
"@agent-native/core": patch
---

Fix agent tool calls failing against discriminated-union action schemas. Gateway-supplied empty placeholders are now stripped from nested objects and union branches (not just top-level fields), `oneOf` validation errors report only the branch the discriminator selects, and the expected-signature hint expands array items and union branches so nested enums are spelled out.
