---
"@agent-native/core": patch
"@agent-native/scheduling": patch
---

Depend on `@agent-native/toolkit` via `workspace:^` instead of `workspace:*`. Publishing now pins a caret range (e.g. `^0.4.3`) rather than an exact version, so an app that scaffolds `@agent-native/toolkit@latest` separately can dedupe against it through normal semver resolution instead of installing two mismatched toolkit copies side by side (which crashed Vite with `"./collab-ui" is not exported`).
