---
"@agent-native/core": minor
---

Add `getAdditionalSession` and `getAdditionalBrowserSession` auth options: an extra identity source consulted before the built-in sessions that, unlike `getSession`, does not replace them. A request the provider does not recognize resolves as it would without it, the built-in sign-in routes stay mounted, and a provider error falls through instead of locking anyone out.

The delegated Builder credential hook (`registerDelegatedBuilderCredentials`) may now return a promise, so hosts on serverless can keep the credential in shared storage.
