---
"@agent-native/core": patch
---

Voice transcript cleanup with OpenAI works again: the cleanup model refuses `temperature: 0`, so every OpenAI cleanup failed with a 400. It now sends `reasoning_effort: "none"` instead, which answers in about a second. Groq keeps `temperature: 0`.
