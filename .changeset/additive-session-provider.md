---
"@agent-native/core": minor
---

Add `getAdditionalSession` and `getAdditionalBrowserSession` auth options: an extra identity source consulted before the built-in sessions that, unlike `getSession`, does not replace them. A request the provider does not recognize resolves as it would without it, the built-in sign-in routes stay mounted, and a provider error falls through instead of locking anyone out.
