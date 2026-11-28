---
"@agent-native/actions": patch
---

`actions init` now prints its install hint for the project's own package manager (from `packageManager` in `package.json`, then the lockfile, then the command that ran it), so an npm, Yarn or Bun project gets `npm install`, `yarn add` or `bun add` instead of `pnpm add`.
