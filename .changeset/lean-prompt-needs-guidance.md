---
"@agent-native/core": patch
---

Fall back to the compact framework prompt when `leanPrompt` is set without a `systemPrompt`, and warn at startup. `leanPrompt` means "the template's own prompt is enough", so a template that sets it without supplying one was served no behavioral guidance at all — indistinguishable from an app that needs none. Templates that pair the two, its intended use, are unaffected.
