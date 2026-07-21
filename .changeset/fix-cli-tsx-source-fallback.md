---
"@agent-native/core": patch
---

Fix `npx @agent-native/core create` failing with `spawn tsx ENOENT`. The CLI launcher's tsx source fallback is now scoped to monorepo source checkouts, so installed packages always run the shipped `dist` build even when tarball extraction leaves `.ts` files newer than their compiled `.js`.
