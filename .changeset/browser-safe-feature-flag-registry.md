---
"@agent-native/core": patch
---

fix(core): keep feature-flag definitions out of the browser server graph

App-shared config that imported feature-flag definitions from
`@agent-native/core/feature-flags` pulled the barrel's server re-exports
(`store` → `settings/store` → `db/client` → request telemetry) into the client
dev graph. Vite's dev server does not tree-shake, so the browser evaluated that
server chain and `request-telemetry`'s top-level `new AsyncLocalStorage()` threw
against the externalized `node:async_hooks` stub, breaking app load in dev
(production tree-shakes it away and was unaffected).

- Add a client-safe `@agent-native/core/feature-flags/registry` entry for
  `defineFeatureFlag` / `defineFeatureFlags` / `registerFeatureFlags` so shared
  config no longer imports the server barrel.
- Make `db/request-telemetry` and `settings/store` resolve `AsyncLocalStorage` /
  `EventEmitter` lazily via `process.getBuiltinModule` (matching
  `server/request-context`) instead of a top-level value import, so the modules
  can be evaluated in any runtime without tripping the browser stub.
- Add a regression guard asserting the client-safe registry entry never reaches
  the server layer and that those modules never statically value-import the
  builtins.
