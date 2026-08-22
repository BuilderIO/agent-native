---
"@agent-native/core": patch
"@agent-native/creative-context": patch
---

Fetch the headless browser at launch instead of embedding it in every serverless function. `@agent-native/creative-context` now depends on `@sparticuz/chromium-min` (46KB) rather than `@sparticuz/chromium` (66.4MB), and passes a version-pinned pack URL to `executablePath()`. The hosted Builder Browser path is unchanged and still preferred; this only affects the local-launch fallback, which now downloads the pack once per container. Set `AGENT_NATIVE_CHROMIUM_PACK_URL` to serve the pack from your own mirror. Measured on slides: server function 126.0MB → 59.6MB, total upload 243.8MB → 111.0MB.
