---
"@agent-native/core": patch
---

Fix Vite dev SSR for npm-installed standalone apps by aliasing react-router to the app's copy and pre-seeding `.env.local` at create time so first boot does not restart Vite.
