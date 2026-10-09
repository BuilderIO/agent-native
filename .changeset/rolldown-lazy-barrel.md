---
"@agent-native/core": patch
---

Enable Rolldown lazy barrel loading in app builds, so named imports from barrel packages like `@tabler/icons-react` no longer make the bundler parse every module they re-export. Opt out with `build.rolldownOptions.experimental.lazyBarrel: false`.
