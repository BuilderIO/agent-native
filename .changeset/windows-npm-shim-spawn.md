---
"@agent-native/core": patch
---

The CLI starts npm and pnpm through a shell on Windows, where they are `.cmd` shims that Node will not start directly. `agent-native add` can inspect a package that isn't installed yet (it failed with `spawnSync npm ENOENT`), `add --apply` and `eject --apply` can run the install, and `agent-native create` from a local framework checkout (`AGENT_NATIVE_CREATE_USE_LOCAL_CORE=1`) can pack local packages again (it failed with `spawnSync npm.cmd EINVAL`).
