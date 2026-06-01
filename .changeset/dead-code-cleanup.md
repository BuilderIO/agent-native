---
"@agent-native/core": patch
"@agent-native/dispatch": patch
---

Remove compiler-verified dead code (unused imports, unused non-exported types,
and side-effect-free unused locals) across the framework. No behavior or public
API changes — only declarations the TypeScript compiler proves are unreferenced.
