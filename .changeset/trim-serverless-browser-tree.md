---
"@agent-native/core": patch
---

Trim dead weight from every serverless function: skip the six Bare-runtime-only packages the browser tree declares but Node can never load, delete playwright-core's trace viewer / HTML reporter / codegen recorder / CLI (`lib/vite`, `lib/tools`, `bin`, `cli.js`), and strip `.d.ts` files from bundled `node_modules` — no runtime resolver reads the `types` condition. Measured on slides: playwright-core 13MB → 7MB, total upload 268.7MB → 247.6MB.
