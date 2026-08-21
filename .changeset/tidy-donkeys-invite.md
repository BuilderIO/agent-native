---
"@agent-native/core": patch
---

Fix desktop Google sign-in against a local dev server. `X-Agent-Native-Desktop-Verifier` is now in the shared CORS allow-header list used by every preflight short-circuit (the Tauri dev renderer origin `http://localhost:1420` is answered by the dev server, which never reached the auth CORS handler that already allowed the header), and a localhost origin receives `Access-Control-Allow-Credentials` when `NODE_ENV === "development"` so the desktop app's credentialed calls work locally. Production credential rules are unchanged.
