---
"@agent-native/core": patch
---

Fix the dev-server speculation-rules endpoint 404ing on the browser's real `Sec-Fetch-Dest: speculationrules` auto-fetch, logging a console error on every page load in `pnpm dev`.
