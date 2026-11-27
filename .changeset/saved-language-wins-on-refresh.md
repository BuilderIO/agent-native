---
"@agent-native/core": patch
---

Keep a saved language choice after a hard refresh: the pre-hydration locale script now prefers the stored explicit preference over the locale guessed from Accept-Language when the server did not supply one.
