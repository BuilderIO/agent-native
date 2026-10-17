---
"@agent-native/core": patch
---

`agent-native typecheck` now runs `react-router typegen` only for apps that import generated route types (`./+types/<route>` or `.react-router/types/...`) or use `href` / `unstable_useRoute` from `react-router`. Other apps skip it, which takes a fresh Chat app from about 1.0s to 0.35s. `@agent-native/core/server/ssr-handler` now declares `virtual:react-router/server-build`, so those apps no longer need `.react-router/types` to typecheck. Typecheck still generates `.generated/action-types.d.ts` and `.generated/actions-registry.ts`, and when typegen runs and fails, it stops with that error instead of continuing into misleading `TS2307` errors. The migration import scan that runs on each Vite config load also skips `.netlify`, `.vercel`, `.nitro` and `.deploy-tmp`, which removes about 5s from dev, build and typegen in apps with local deploy output.
