---
"@agent-native/core": patch
---

Fix `pnpm dev` in a multi-app workspace failing with `spawn pnpm ENOENT` on Windows when pnpm is a `pnpm.cmd` shim.
