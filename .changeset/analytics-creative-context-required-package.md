---
"@agent-native/core": patch
---

Add `creative-context` to the Analytics template's `requiredPackages` metadata. The Analytics template's `package.json` already depends on `@agent-native/creative-context` as a `workspace:*` dep, but the scaffolder's template metadata didn't list it, so scaffolding a workspace with Analytics but none of the other creative-context-dependent templates produced a dangling `workspace:*` reference and `pnpm install` failed with `ERR_PNPM_WORKSPACE_PKG_NOT_FOUND`.
