---
"@agent-native/core": patch
---

One Google Gemini key now powers chat models, voice input, embeddings, and image generation. Settings registers and writes `GOOGLE_GENERATIVE_AI_API_KEY`; keys saved under the older `GEMINI_API_KEY` name keep working everywhere, and removing the Gemini key removes it under both names. New `resolveGeminiApiKey()`, `resolveSecretWithAliases()`, and `readGeminiDeployCredentialEnv()` in `@agent-native/core/server`, and `GEMINI_API_KEY` / `secretKeyNames()` in `@agent-native/core/secrets`.

An older `GEMINI_API_KEY` row saved at another scope, such as Brain's workspace key, now appears with the custom keys so owners and admins can remove it, and `DELETE /_agent-native/secrets/adhoc/:name` accepts `?scope=user|workspace` to remove the listed row rather than a same-named personal one.
