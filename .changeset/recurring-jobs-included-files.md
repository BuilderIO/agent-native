---
"@agent-native/core": patch
---

Declare `includedFiles: ["**"]` on the emitted `agent-native-recurring-jobs` Netlify scheduled function so publishing no longer fails with "outside the supported packaging slice"; its entry imports `node:crypto`, and the deploy packager only accepts an omitted `includedFiles` for import-free scheduled functions.
