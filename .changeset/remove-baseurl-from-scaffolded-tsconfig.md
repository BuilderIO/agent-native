---
"@agent-native/core": patch
---

Stop injecting the `baseUrl` compiler option into scaffolded app tsconfigs. `baseUrl` is deprecated and errors in TypeScript 6 (TS5101/TS5102) and removed in TypeScript 7. The `create` CLI now relies on `paths` (including the `"*": ["./*"]` catch-all) which resolve relative to the project's own tsconfig, fixing `error TS5102: Option 'baseUrl' has been removed` under tsgo / `@typescript/native-preview` in generated starters.
