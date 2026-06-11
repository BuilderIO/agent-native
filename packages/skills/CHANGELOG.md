# @agent-native/skills

## 0.1.1

### Patch Changes

- 7ee8be6: Prompt for install scope (project vs user) during interactive installs when
  `--scope`/`-g`/`--project` is not passed, instead of silently defaulting to
  user scope. Explicit flags and non-interactive runs are unchanged.

## 0.1.0

### Minor Changes

- 3c1d3eb: Add the `@agent-native/skills` installer CLI for plain Codex/Claude skill repos and let `agent-native skills add` delegate public skill repositories like `BuilderIO/skills` to it.
