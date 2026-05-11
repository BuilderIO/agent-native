---
"@agent-native/core": patch
---

Fix workspace scaffolds of `slides` and `videos` failing with `ERR_PNPM_WORKSPACE_PKG_NOT_FOUND` for `@agent-native/pinpoint`. Both templates depend on pinpoint but were not declaring it in `requiredPackages`, so it never got copied into `packages/pinpoint` and the `workspace:*` reference could not resolve.
