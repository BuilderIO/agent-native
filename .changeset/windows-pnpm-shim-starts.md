---
"@agent-native/core": patch
"@agent-native/dispatch": patch
---

Start pnpm through a shell on Windows, where it is a `pnpm.cmd` shim. `agent-native create` no longer says pnpm is missing when it is installed, `agent-native amplify-stream` can run its build, and Dispatch can add an app to a workspace there.
