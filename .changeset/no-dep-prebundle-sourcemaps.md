---
"@agent-native/core": patch
---

Stop writing sourcemaps into the Vite dependency pre-bundle cache, which roughly halves `node_modules/.vite/deps` (and the transient double-size peak during a re-optimize) so workspaces stop running out of disk. Set `AGENT_NATIVE_DEP_SOURCEMAPS=1` to restore them when stepping into third-party code in the debugger.
