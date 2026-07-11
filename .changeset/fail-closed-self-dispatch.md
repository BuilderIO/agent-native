---
"@agent-native/core": patch
---

Fail closed on internal self-dispatch processor routes when no A2A_SECRET is configured and the runtime is not provably local (previously an unrecognized deployed host with no secret ran these routes unauthenticated).
