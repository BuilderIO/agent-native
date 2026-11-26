---
"@agent-native/core": patch
---

Route every local development identity credential check through one gate in `server/local-dev-identity.ts`, shared by route handlers and actions.
