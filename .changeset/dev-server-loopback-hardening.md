---
"@agent-native/core": patch
---

Refine local dev server defaults:

- The dev action discovery file now lives under `~/.agent-native/dev-servers/`, and Vite no longer serves files under `.agent-native/`.
- Local request detection also considers the `Host` and forwarding headers.
- In Builder cloud dev containers, local development conveniences are off by default; set `AGENT_NATIVE_ALLOW_BUILDER_PREVIEW_LOCAL_DEV=1` to enable them.
