---
"@agent-native/core": patch
---

Fix `pnpm dev` in multi-app workspaces failing with `spawn pnpm ENOENT` on Windows when only a `pnpm.cmd` shim is on PATH.
