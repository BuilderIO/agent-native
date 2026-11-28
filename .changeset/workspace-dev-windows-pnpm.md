---
"@agent-native/core": patch
"@agent-native/skills": patch
---

Let the Windows launch of npm and pnpm shims accept a path that contains `%NAME%`. `shimSpawnTarget` now passes such an argument in a private environment variable instead of refusing it, and every caller adds that variable to the environment it spawns with.
