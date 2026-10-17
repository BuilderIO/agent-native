---
"@agent-native/core": patch
---

`agent-native typecheck` now runs `react-router typegen` with an empty Vite config. Typegen reads the Vite config only to check for the React Router RSC plugin, and resolving the app's own config ran every Core Vite plugin. Typegen now takes about 0.2s instead of 0.5–3s and writes the same route types, so a fresh Chat app typechecks in about 0.5s instead of 1.0s. Typecheck also writes `.generated/action-types.d.ts` and `.generated/actions-registry.ts` itself, since typegen no longer loads the Core Vite plugin that wrote them, and a typegen failure now stops typecheck with that error instead of continuing into misleading `TS2307` errors. The migration import scan that runs on each Vite config load also skips `.netlify`, `.vercel`, `.nitro` and `.deploy-tmp`, which removes about 5s from dev and build in apps with local deploy output.
