---
"@agent-native/core": patch
"@agent-native/recap-cli": patch
---

Stop shipping unused Playwright packages to consumers. `@agent-native/core`
declared `playwright` in both `devDependencies` and `optionalDependencies`
without ever importing it at runtime; the optional entry is gone, so it no
longer installs for every consumer. `@agent-native/recap-cli` no longer
declares `@playwright/test` as an optional dependency — its sibling `playwright`
optional dependency always resolved first, so the `@playwright/test` fallback
import could never be reached. That fallback now rethrows the original
`playwright` failure instead of a misleading "cannot find `@playwright/test`".
