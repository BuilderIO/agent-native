---
"@agent-native/core": patch
---

`agent-native upgrade` adds `"@agent-native/*"` to `minimumReleaseAgeExclude` in workspaces scaffolded before 0.197.0, so a same-day framework release no longer blocks `pnpm install`.
