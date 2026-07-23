---
"@agent-native/core": minor
---

`agent-native dev --inspect` (and `--inspect-brk`, optionally `=<port>`) now
attaches the Node inspector to **only** the Nitro API-server process, on a
single known port (default 9229). It selects Nitro's `node-process` dev runner
so the server is a real, attachable process, and injects `NODE_OPTIONS` through
a Vite preload that runs before Vite's own startup — so Vite, pnpm, and the CLI
are never inspected and there is exactly one debugger target. Set
`NITRO_DEV_RUNNER` yourself to override the runner.
