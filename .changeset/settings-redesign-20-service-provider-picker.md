---
"@agent-native/core": minor
---

Owners and admins can pick the provider for Voice input, Image generation, and Embeddings with the new `manage-service-providers` action (org setting `service-providers`). Batch voice transcription tries the organization's choice first when the user's own provider is auto, then the usual Builder.io, Gemini, Groq, OpenAI order. Embeddings no longer turn off when several providers are available: `defaultEmbeddingFamily` uses the organization's choice, or Builder.io, then Gemini, Cohere, and Voyage, and `resolveDefaultEmbeddingFamily()` applies it for the current request. `/_agent-native/voice-providers/status` reports the choice as `orgProvider`.
