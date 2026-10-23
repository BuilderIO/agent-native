---
"@agent-native/core": patch
---

Restrict A2A bearer token verification and failure diagnostics to the supported HS256 signing algorithm.

Report unsupported signing algorithms as a distinct diagnostic cause.
