---
"@agent-native/core": patch
---

Fix Vite dev SSR for standalone apps using `file:@agent-native/core` by aliasing monorepo core source and deduping `react-router`. Add a Playwright dev smoke test that catches HydratedRouter/Meta render failures after auto-login.
