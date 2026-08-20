# @agent-native/scheduling

Older releases are archived in [changelog/archive/CHANGELOG.md](./changelog/archive/CHANGELOG.md).

## 0.1.39

### Patch Changes

- Updated dependencies [9e21e1b]
- Updated dependencies [9e21e1b]
- Updated dependencies [9e21e1b]
  - @agent-native/toolkit@0.16.0

## 0.1.38

### Patch Changes

- Updated dependencies [f07ec04]
  - @agent-native/toolkit@0.15.0

## 0.1.37

### Patch Changes

- Updated dependencies [aa17e22]
  - @agent-native/toolkit@0.14.0

## 0.1.36

### Patch Changes

- Updated dependencies [106af0e]
  - @agent-native/toolkit@0.13.0

## 0.1.35

### Patch Changes

- f499dff: Add `@agent-native/core/vitest-config`, a base vitest config that caps a suite's
  worker pool so concurrent test runs no longer oversubscribe the CPU. Defaults to
  25% of cores; override with `VITEST_CONCURRENCY`. Every template and package
  config merges it in.
- Updated dependencies [f499dff]
  - @agent-native/toolkit@0.12.2
