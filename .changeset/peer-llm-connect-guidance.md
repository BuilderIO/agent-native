---
"@agent-native/core": patch
---

A peer app's "no LLM provider" failure no longer sends the reader to a settings path that may not exist in that app. The message points to the peer's own origin and its connect prompt instead. Delegated A2A runs now resolve the engine with the verified caller's email and org, like interactive chat.
