---
"@agent-native/core": patch
---

Fix an SSR crash (`ERR_MODULE_NOT_FOUND` for `templates/default/app/i18n/en-US.js`) in consuming apps. The compiled client i18n module reached into `src/templates`, which ships as verbatim copy-only scaffolding (`.ts` only, never compiled to `.js` in `dist`), so Node's strict ESM resolver failed during SSR even though Vite's on-the-fly client transform worked. The default English catalog used for translation fallbacks now lives in a real compiled source module (`src/localization/default-messages.ts` → `dist/localization/default-messages.js`). A postbuild guard imports the SSR-critical entry points under Node's ESM resolver to prevent regressions.
