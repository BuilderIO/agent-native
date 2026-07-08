---
"@agent-native/core": patch
---

Scaffold new apps with `@agent-native/toolkit` pinned to whatever `@agent-native/core@latest` depends on instead of an independent `latest` dist-tag. This prevents pnpm from installing two mismatched toolkit copies side by side (which crashed Vite with `"./collab-ui" is not exported`). The lookup is memoized per scaffold and falls back to `latest` when the registry is unreachable.
