---
"@agent-native/core": minor
---

Add a shared `@agent-native/core/provider-api` module: a reusable provider-API runtime with a credential-resolver hook, SSRF-safe outbound dispatch, a provider catalog (base URLs, auth styles, credential keys, docs/spec URLs, placeholders, examples), and helpers (`createProviderApiRuntime`, `getProviderApiConfig`, `isProviderApiId`, `listProviderApiCatalog`, `listProviderApiIdsForTemplateUse`, `PROVIDER_API_IDS`). Templates can build a thin credential adapter on top instead of hardcoding each provider endpoint.
