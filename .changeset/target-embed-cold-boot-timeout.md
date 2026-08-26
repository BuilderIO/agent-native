---
"@agent-native/core": patch
"@agent-native/dispatch": patch
---

Give the Dispatch workspace embed handshake a cold-boot connect budget so opening an app whose server is still starting no longer fails as unreachable. `McpClientManager` now accepts a `connectTimeoutMs` option, and the embed session mint spends up to 90s per attempt within a 95s total budget instead of the 5s interactive default, matching the dev gateway's own readiness wait. The browser side no longer aborts that wait early: `useActionMutation` accepts `timeoutMs`, and the workspace embed mints use it so a cold-booting app reports the server's real outcome instead of "Action create-workspace-app-embed-session timed out after 60s".
