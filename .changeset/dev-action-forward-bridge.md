---
"@agent-native/core": patch
---

`pnpm action <name>` now forwards to an already-running local dev server over loopback instead of opening the (single-process) local database itself, so it no longer fails with a PGlite process-lock error while `pnpm dev` is running.
