---
"@agent-native/core": patch
---

Fix AI SDK provider engines being unusable on bundled serverless deploys, and stop rewriting custom model IDs on save/read.

- **Serverless package detection.** `isAgentEnginePackageInstalled` relied on `require.resolve`, which fails on bundled serverless runtimes (Vercel/Netlify via Nitro) where optional provider packages (`ai`, `@ai-sdk/*`) are inlined into the function bundle. Every engine-usability gate then rejected the AI SDK engines and the agent silently fell back to the native Anthropic engine. Package resolution now treats a resolve miss as available only when there is real evidence of a bundled runtime (Vercel/Netlify markers, or a bundle-output module path), and defers to the engine's own dynamic `import()` as the real gate. Generic container/Lambda/Cloud Run deploys that ship a real `node_modules` still surface genuine "package not installed" misses.
- **Custom model preservation.** `normalizeModelForEngine` replaced any unrecognized model ID with the engine default when the settings actions passed a static registry entry, so a custom OpenAI-compatible gateway model (e.g. an Ollama model) reverted to the OpenAI default on save and read. The set/list/app-default actions now resolve the OpenAI-compatible-endpoint capability (`resolveEnginePreservesCustomModels`) and pass it through, preserving custom IDs verbatim — including version-shaped IDs — while first-party OpenAI still normalizes unknown IDs to a supported model.
