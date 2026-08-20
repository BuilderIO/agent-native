# @agent-native/pinpoint

## 0.1.18

### Patch Changes

- 0aada94: Serve the stateless MCP 2026-07-28 protocol natively while preserving stateless
  legacy clients, automatically negotiate the newest supported protocol from
  outbound clients and stdio bridges, and harden MCP OAuth issuer, client type,
  scope, credential binding, and Client ID Metadata Document behavior. Require
  durable, single-use MCP 2026 approval elicitation before running actions marked
  `needsApproval`.

  Update the Pinpoint MCP server example to use the stable split MCP v2 packages.

## 0.1.19

### Patch Changes

- f499dff: Add `@agent-native/core/vitest-config`, a base vitest config that caps a suite's
  worker pool so concurrent test runs no longer oversubscribe the CPU. Defaults to
  25% of cores; override with `VITEST_CONCURRENCY`. Every template and package
  config merges it in.

## 0.1.17

### Patch Changes

- 22e9951: Test-only: the `FileStore.update()` spec now drives the clock with fake timers instead of assuming wall-clock advances between two back-to-back writes, which made it flake when both landed in the same millisecond. No runtime behavior change.

## 0.1.16

### Patch Changes

- 52cce19: Shrink the dispatch and pinpoint install footprint by removing code and
  dependencies nothing could reach. Dispatch drops the unused pre-auth routing
  helper — `rootDispatchRedirect` had no callers and was not re-exported from
  `./server` or any other published subpath — along with the `@libsql/client` and
  `h3` dependencies, which had no imports in the package but were still installed
  for every consumer. Pinpoint drops the `HistoryDropdown` and `SettingsPanel`
  overlay components, which were never rendered by the overlay and were not
  reachable from any of its `.`, `./react`, `./primitives`, `./server`, or
  `./types` entry points. No exported API changes.

## 0.1.15

### Patch Changes

- 8df32f6: Publish the latest Builder link tracking updates.

## 0.1.14

### Patch Changes

- b6d7f87: Move portable rich-editor, context presentation, and visual design controls into Toolkit while preserving Core compatibility re-exports, and add accurate side-effect metadata to capability packages.

## 0.1.13

### Patch Changes

- 38ca6fa: Make annotation badges appear from a natural scale and respect reduced-motion preferences.

## 0.1.12

### Patch Changes

- f43d34c: Stage atomic writes inside the data directory so saves work when /tmp is a different filesystem.

## 0.1.11

### Patch Changes

- 823d635: Upgrade the workspace toolchain to TypeScript 7 (`tsc`) with a side-by-side TypeScript 6 API package for tools that still need programmatic access. Replace `@typescript/native-preview` / `tsgo` with the stable `typescript` 7 release.

## 0.1.10

### Patch Changes

- 2a03c35: Adopt the native TypeScript and oxfmt package build baselines.

## 0.1.9

### Patch Changes

- a784d3c: Update user-facing `npx` guidance to recommend explicit `@latest` package invocations.

## 0.1.8

### Patch Changes

- a56d93d: Remove unused imports, dead state, no-op plugin hooks, and debug logging from package internals.

## 0.1.7

### Patch Changes

- d4013f0: Remove unused imports, dead state, no-op plugin hooks, and debug logging from package internals.

## 0.1.6

### Patch Changes

- 3107f96: Preserve MCP tool error and read-only metadata through action execution, and allow Pinpoint's empty test suite to pass intentionally.

## 0.1.5

### Patch Changes

- 1ba9738: Keep the pinpoint toolbar inside the viewport when the agent sidebar is open by tracking the visible sidebar width via MutationObserver + ResizeObserver and clamping toolbar position + drag bounds.

## 0.1.4

### Patch Changes

- Updated dependencies [bcb2069]
- Updated dependencies [e375642]
  - @agent-native/core@0.8.0

## 0.1.3

### Patch Changes

- 4e3631b: Add `publishConfig.provenance: true` so `pnpm publish` (called by `changeset publish` from the auto-publish workflow) requests an OIDC token from GitHub Actions and publishes via npm trusted publisher. Without this, `pnpm publish` looked for token-based auth and failed with `ENEEDAUTH`.
- Updated dependencies [4e3631b]
  - @agent-native/core@0.7.85
