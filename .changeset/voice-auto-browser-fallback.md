---
"@agent-native/core": patch
---

Fix chat dictation: "auto" mode now uses browser-native SpeechRecognition when available, matching the macros-app record-button experience. Words stream incrementally into the composer with no server API key required. Explicit server providers (builder, gemini, groq, openai) are unchanged.
