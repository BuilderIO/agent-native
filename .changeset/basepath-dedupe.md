---
"@agent-native/core": patch
---

Consolidate 7 private copies of normalizeAppBasePath/getAppBasePath onto the canonical exported module in `server/app-base-path.ts`. Adds `getAppBasePathFromViteEnv` for SSR builds that need `import.meta.env` fallback, and `stripAppBasePath` as a shared helper. Template-literal copies inside the generated Cloudflare worker entry in `deploy/build.ts` are intentionally left in place as they cannot import at runtime.
