---
"@agent-native/core": patch
---

Stop shipping the serverless browser runtime into apps that cannot use it. The
Chromium/Playwright copy now runs only when the app itself depends on the
browser runtime, instead of resolving a sibling workspace package's Chromium
through the pnpm store. Serverless function dirs also drop prebuilds that cannot
execute on Linux x64/arm64 and any local `data/` SQLite database before the
extra Netlify functions are cloned, and the Netlify deploy guard now reports
per-function sizes and fails when one exceeds its budget.
