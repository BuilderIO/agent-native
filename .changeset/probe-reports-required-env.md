---
"@agent-native/core": patch
---

`/_agent-native/ping?configuration=1` now reports environment variables an app declares under `runtime.environment.required` when they are missing, as the docs say it does. A deployed server has no `agent-native.config.ts` to read, so the build now embeds the declared names in the server bundle, the same way it embeds the hosted harness setting. A dev server reads them from the app's config. The probe still never takes variable names from the request.
