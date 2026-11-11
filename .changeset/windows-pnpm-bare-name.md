---
"@agent-native/core": patch
---

Fix `agent-native deploy` failing on Windows with "Cannot find module" when the `pnpm` on PATH is pnpm 11's launcher. Workspace builds now start `pnpm` by its bare name, so the launcher finds its own files.
