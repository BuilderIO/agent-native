---
"@agent-native/core": patch
"@agent-native/dispatch": patch
"@agent-native/scheduling": patch
"@agent-native/pinpoint": patch
"@agent-native/toolkit": patch
---

Upgrade the workspace toolchain to TypeScript 7 (`tsc`) with a side-by-side TypeScript 6 API package for tools that still need programmatic access. Replace `@typescript/native-preview` / `tsgo` with the stable `typescript` 7 release.
