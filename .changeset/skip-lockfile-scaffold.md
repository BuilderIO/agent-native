---
"@agent-native/core": patch
---

Exclude `pnpm-lock.yaml` from CLI scaffolding so a freshly created app does not ship a stale lockfile copied from the source template.
