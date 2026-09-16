---
"@agent-native/core": patch
---

Add the `alg` and `crv` columns Better Auth 1.7 writes on every minted JWKS key, to both the Drizzle auth schema and the framework release migrations. Without them the Drizzle adapter rejected the key mint that runs on the first `/get-session`, so an app on core 0.180.0 with no signing key yet failed every session check. The framework health report now checks the two columns as well.
