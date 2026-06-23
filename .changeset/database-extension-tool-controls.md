---
"@agent-native/core": patch
---

Add configurable agent tool controls for database and extension surfaces. `databaseTools` now accepts `"write"` (default), `"read"`, and `"off"` in addition to booleans, and `extensionTools: false` removes framework extension-management tools and prompt guidance.
