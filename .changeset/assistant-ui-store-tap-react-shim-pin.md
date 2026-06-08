---
"@agent-native/core": patch
---

Fix fresh-install scaffold builds failing on `@assistant-ui/tap/react-shim`.
Newly published `@assistant-ui/store@0.2.14` bumped its `@assistant-ui/tap` peer
to `^0.6.0` and started importing the `@assistant-ui/tap/react-shim` subpath,
which exists **only** in tap 0.6.0. But `@assistant-ui/react@0.12.x` (our pin)
still depends on `@assistant-ui/tap@^0.5.x`, so the single hoisted tap resolves
to 0.5.14 — which has no `react-shim` export. A lockfile-less `pnpm install`
(the scaffold E2E CI job and any freshly-created app) floated `store` to 0.2.14
and the calendar build then failed under Rolldown/Vite with:

```
"./react-shim" is not exported … from package @assistant-ui/tap
ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL  calendar@ build: `agent-native build`
```

Pin `@assistant-ui/store` to `0.2.13` (the latest release that still peers
`@assistant-ui/tap@^0.5.x` and does not import `react-shim`) and add an explicit
`@assistant-ui/tap@^0.5.14` so the whole `@assistant-ui/*` family resolves to a
self-consistent, tap-0.5.x generation (react 0.12.28 · store 0.2.13 · core
0.1.17 · tap 0.5.14) on a clean install. No app-code changes — assistant-ui
is consumed exactly as before.
