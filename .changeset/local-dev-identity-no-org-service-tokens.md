---
"@agent-native/core": patch
---

Refuse to mint an organization service token for the local development identity (`dev@local.test`, the `AUTH_DISABLED` session) unless the request comes from this machine over localhost. With no request, such as a background run, the identity alone is refused.
