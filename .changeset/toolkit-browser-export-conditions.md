---
"@agent-native/toolkit": patch
---

Add explicit `browser` and `development` export conditions so Vite 8 / Rolldown can resolve toolkit subpaths (including `./collab-ui`) in Fusion agent-native starter projects.
