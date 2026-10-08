---
"@agent-native/core": patch
---

Close worker-owned database clients during dev server shutdown so `.env` restarts can reopen PGlite safely.
