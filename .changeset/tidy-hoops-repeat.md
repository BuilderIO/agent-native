---
"@agent-native/core": patch
---

Stop handing an Anthropic credential to a non-Anthropic engine. When a user selected an OpenAI (or Gemini, Groq, Mistral, Cohere) engine but had no key for it, the deploy-level `ANTHROPIC_API_KEY` — or the plugin's `options.apiKey` — was passed straight through to that provider's endpoint. The provider rejected it with a 401, and the failure was then recorded against `OPENAI_API_KEY`, so the user saw "the model provider rejected the saved API key" for a key they had never saved.

`resolveEngine` now accepts `apiKeyEnvVar` so a caller can declare which env var its key was issued for, and drops the key when the selected engine does not use that var. The previous protection compared key values against stored secrets, which only worked on automatic engine selection and could never match a host-supplied key; declaring provenance covers the explicit `engineOption` branches too.

Every caller that resolved a key before choosing an engine now goes through one resolver, `resolveOwnerEngineApiKey`, which reads the key for the engine that will actually be selected instead of for whatever the saved `agent-engine` setting names. That closes the same leak in web chat with a plugin-level `engine`, `completeText`, the A2A and MCP processors, agent-teams sub-agents, and Brain's capture classifier. Chat title generation posts directly to Anthropic, so it now asks for the owner's Anthropic key specifically and falls back to a truncated title rather than sending another provider's key; the sub-agent Anthropic fallback engine likewise refuses to inherit a run key issued for a different provider.

The chat `save-key` route reads the provider-to-env mapping from `PROVIDER_ENV_META` instead of a local copy that omitted OpenRouter, and the environment-variable docs list `ANTHROPIC_API_KEY` alongside the other provider fallbacks plus `AGENT_ENGINE` / `AGENT_ENGINE_PREFER_BYO_KEY`.
