---
"@agent-native/toolkit": patch
---

Keep a typed `@` in the agent composer. It now opens inline mention suggestions that leave focus in the prompt instead of the + menu, and the suggestions close once nothing matches, so a literal like `@builder.io` stays plain text and Enter sends it. Sent messages show chips only for real mentions, not for any `@word`.
