---
"@agent-native/core": patch
---

Keep the core composer runtime adapters stable across re-renders, so composer effects keyed on them (such as the voice button's `voice-input-preference` read) no longer re-run and refetch on every render.
