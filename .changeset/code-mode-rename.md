---
"@agent-native/core": minor
---

Rename the agent-capability "dev mode" to "Code mode" for clarity. This is the
toggle that lets the agent run shell/file/raw-DB tools and edit the app's own
source code — now named distinctly from environment dev mode (`NODE_ENV` /
Vite).

- `useCodeMode()` is now the primary client hook, returning `{ isCodeMode,
canToggle, isLoading, setCodeMode }`.
- `useDevMode()` is kept as a `@deprecated` alias that returns the old
  `{ isDevMode, canToggle, isLoading, setDevMode }` shape, delegating to the
  same shared internal state so existing callers keep working.
- Back-compat is fully preserved: the `AGENT_MODE` env var, the
  `/_agent-native/agent-chat/mode` endpoint (its payload still uses `devMode`),
  and the `agent-chat.mode` settings key are unchanged. The `/mode` GET response
  now additively includes a `codeMode` field mirroring `devMode`.
