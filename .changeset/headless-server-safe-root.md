---
"@agent-native/core": minor
---

Make the package root (Node `default` entry) server-safe so headless apps work out of the box.

The top-level `@agent-native/core` entry used by Node/SSR/headless contexts no
longer re-exports the React client barrel. Re-exporting `./client/index.js` from
the Node entry eagerly pulled `react`, `react-router`, and
`@tanstack/react-query` into the module graph, so a freshly scaffolded
`--headless` app (which installs none of those) crashed at module load on the
documented first command, `pnpm action hello`. The React client surface still
ships via the `browser` condition (so UI bundles that import client helpers from
the bare specifier keep working) and via the explicit `@agent-native/core/client`
subpath.

Also fixes the headless scaffold's `tsconfig.json`, which inherited
`types: ["vite/client"]` from the shared UI base config and failed `pnpm
typecheck` with TS2688 because a headless app has no Vite dependency. It now
overrides `types` to the Node set it actually uses.

Migration: code that runs through the Node entry (SSR, scripts, headless) and
imports React client helpers (`useDbSync`, `cn`, `useSession`, `sendToAgentChat`,
etc.) from `@agent-native/core` should import them from `@agent-native/core/client`
instead. Browser-only code is unaffected.
