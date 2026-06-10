---
"@agent-native/core": patch
---

Prune orphaned \*.spec.js / \*.spec.d.ts files from dist in finalize-build.mjs; add incremental tsc across all tsc-built packages to speed up repeated builds.
