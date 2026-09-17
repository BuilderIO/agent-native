---
"@agent-native/core": patch
---

`pnpm action db-query` now forwards to the running local dev server instead
of failing when PGlite's single-process lock is already held by `pnpm dev`.
The forwarded query runs through the same validation and row scoping as the
in-process path, using the caller's resolved identity, and falls back to
opening the database directly when no dev server is running or a custom
`--db` directory is given.
