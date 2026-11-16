---
"@agent-native/core": patch
---

Production client bundles no longer carry the Vite dev-server recovery script. `getThemeInitScript()` now gates it on a static `import.meta.env?.DEV` read that the bundler folds away, so apps stop shipping it to every visitor. Pages a dev server renders still inline it, and server rendering where core loads unbundled still works.
