---
"@agent-native/core": patch
---

Fix the Builder connect popup going blank after the space picker in Builder-hosted previews. The cli-auth `redirect_url` could resolve to a loopback origin (from `BETTER_AUTH_URL`/`WORKSPACE_GATEWAY_URL`), which points at the visitor's machine rather than the app, so Builder sent the popup — and the returned Builder keys — somewhere dead. Loopback callbacks are now only used when the app is reached from the same machine, and `/builder/connect` refuses to start the flow with an actionable error instead of handing Builder an unreachable redirect.
