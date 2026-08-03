---
"@agent-native/core": patch
---

Keep workspace development lazy by default so unused apps do not build Vite
dependency caches and consume disk and memory. Background prewarming remains
available with `--prewarm` or `WORKSPACE_PREWARM=1`.
