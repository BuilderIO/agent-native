---
"@agent-native/core": patch
---

Stop writing a second full copy of the server bundle for every extra Netlify
function. The durable-background, integration-recovery, workspace
`<app>-server`, and Vercel `<app>-server.func` emits now share one on-disk copy
through hard links, so a build no longer doubles (or, in a workspace, multiplies)
its function output. Each function still ships a complete, independent bundle —
only the wasted disk goes away. Builds also stop emitting the throwaway
`dist/<app>/<app>` client build for presets that already mount `publicDir` at the
app base path.
