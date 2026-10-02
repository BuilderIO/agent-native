---
"@agent-native/core": patch
---

Keep the JWKS endpoint publishing the live signing key once an app's `jwks` table holds more than 100 rows, and stop minting a new key on every signature in that state.
