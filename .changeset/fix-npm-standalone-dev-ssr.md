---
"@agent-native/core": patch
---

Fix Vite dev SSR for npm-installed standalone apps by aliasing react-router to the app's install so SSR and the dev router share one React Router context.
