# @agent-native/pinpoint

Older releases are archived in [changelog/archive/CHANGELOG.md](./changelog/archive/CHANGELOG.md).

## 0.1.19

### Patch Changes

- f499dff: Add `@agent-native/core/vitest-config`, a base vitest config that caps a suite's
  worker pool so concurrent test runs no longer oversubscribe the CPU. Defaults to
  25% of cores; override with `VITEST_CONCURRENCY`. Every template and package
  config merges it in.

## 0.1.18

### Patch Changes

- 0aada94: Serve the stateless MCP 2026-07-28 protocol natively while preserving stateless
  legacy clients, automatically negotiate the newest supported protocol from
  outbound clients and stdio bridges, and harden MCP OAuth issuer, client type,
  scope, credential binding, and Client ID Metadata Document behavior. Require
  durable, single-use MCP 2026 approval elicitation before running actions marked
  `needsApproval`.

  Update the Pinpoint MCP server example to use the stable split MCP v2 packages.

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
