---
"@agent-native/core": patch
---

`WORKSPACE_DEFAULT_APP` now works from the workspace root `.env` in `agent-native dev` (variables already in the environment still win), and workspace Netlify and Vercel deploys send `/` to that app at build time instead of always sending it to Dispatch.
