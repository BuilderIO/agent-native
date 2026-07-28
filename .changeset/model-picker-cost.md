---
"@agent-native/toolkit": patch
"@agent-native/core": patch
---

Show relative cost per model in the composer's model picker. Each row now
carries a quiet `$`/`$$`/`$$$` suffix so a user can tell an entry model from a
flagship one before selecting it, rather than discovering the difference in
their bill. The tier reuses the token list the picker already sorts by
(`MODEL_COST_ORDER`) and reflects each provider's own entry/mid/flagship ladder
— it is not a cross-provider price claim. Models outside that list render with
no label at all; a guessed tier would read as fact.
