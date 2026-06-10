---
"@agent-native/core": patch
---

Gate localhost CORS fallback on NODE_ENV=development so production deployments without CORS_ALLOWED_ORIGINS no longer trust arbitrary localhost origins with credentials.
