---
"@agent-native/core": patch
---

Dev servers now watch files for apps checked out inside a `.claude/` (or other normally ignored) directory, such as `.claude/worktrees/*`. The default watch ignores are matched below the app root instead of against its ancestors, which previously disabled HMR entirely for those checkouts.
