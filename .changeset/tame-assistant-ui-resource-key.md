---
"@agent-native/core": patch
---

Prevent folded continuation turns from persisting duplicate assistant-ui tool-call resource keys, sanitize already-saved duplicates, and recover standalone prompt composers if the duplicate-key crash still appears.
