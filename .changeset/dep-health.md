---
"@agent-native/core": patch
---

Dependency health fixes on the auth/runtime critical path:

- Bump `better-auth` from exact `1.6.0` to `1.6.16` (16 patches behind)
- Add root pnpm override pinning `kysely` to `^0.28.9` to prevent `0.29.x` pulling in breaking `DEFAULT_MIGRATION_TABLE` removal that breaks Vite builds while tsc stays green
- Add `"sideEffects": ["*.css"]` to enable tree-shaking; client barrel is excluded (has module-level `installRouteChunkRecovery` and `stripAuthRedirectParamFromUrl` side effects)
- Remove `@tabler/icons-react` from `dependencies` — already declared as optional peer; every template depends on it directly
- Align `recharts` from exact pin `3.8.1` to range `^3.8.1` matching templates
- Bump `nitro` nightly from `3.0.260415-beta` to `3.0.260603-beta`
- Bump `vite` catalog pin from `8.0.3` to `8.0.16`
