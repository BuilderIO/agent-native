---
"@agent-native/core": patch
---

New apps and workspaces pin every `@agent-native/*` package to the exact version released with the Core that created them, instead of `latest` or a `^` range. A scaffold made shortly before a new release no longer installs a newer Dispatch, OTel, or Toolkit beside the older Core, which used to crash `pnpm dev` with missing exports such as `appServerPath`.
