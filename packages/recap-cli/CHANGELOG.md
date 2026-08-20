# @agent-native/recap-cli

Older releases are archived in [changelog/archive/CHANGELOG.md](./changelog/archive/CHANGELOG.md).

## 0.5.5

### Patch Changes

- 16cbc53: Stop PR Visual Recap gate skips from creating visible pull request comments.

## 0.5.4

### Patch Changes

- 061896a: Use the recap CLI package as the single implementation source for Core's recap skill, Plan block, and publish-token helpers while preserving Core compatibility exports.

## 0.5.3

### Patch Changes

- d6e7c5c: Stop shipping unused Playwright packages to consumers. `@agent-native/core`
  declared `playwright` in both `devDependencies` and `optionalDependencies`
  without ever importing it at runtime; the optional entry is gone, so it no
  longer installs for every consumer. `@agent-native/recap-cli` no longer
  declares `@playwright/test` as an optional dependency — its sibling `playwright`
  optional dependency always resolved first, so the `@playwright/test` fallback
  import could never be reached. That fallback now rethrows the original
  `playwright` failure instead of a misleading "cannot find `@playwright/test`".
- d6e7c5c: Stop a second Chromium from being downloaded alongside the one already on disk.

  First-party workspace packages now take Playwright from an exact catalog pin, so
  a caret cannot resolve forward to a release tied to a different Chromium
  revision. The two packages that declare Playwright as a published optional
  dependency — `@agent-native/creative-context` and `@agent-native/recap-cli` —
  deliberately keep a caret range instead: an exact range in a library stops a
  consumer who already has a different Playwright from deduping, which forces a
  nested copy and downloads exactly the second browser this change exists to
  avoid.

## 0.5.2

### Patch Changes

- f499dff: Add `@agent-native/core/vitest-config`, a base vitest config that caps a suite's
  worker pool so concurrent test runs no longer oversubscribe the CPU. Defaults to
  25% of cores; override with `VITEST_CONCURRENCY`. Every template and package
  config merges it in.

## 0.5.1

### Patch Changes

- 03a043e: Retry transient recap document-load timeouts and only embed screenshot previews when both light and dark themes are available.
