---
"@agent-native/core": patch
---

Stop workspaces from accumulating duplicate physical copies of
`@agent-native/core`.

`agent-native upgrade` now rewrites the `latest` specs it installs back to the
exact resolved versions, so a committed manifest pins one release instead of
re-resolving on every install. If a version cannot be read after a successful
install, upgrade reports which specs are still floating rather than claiming
the upgrade finished.

Apps added to an existing workspace inherit the framework versions the
workspace root already pins, and freshly scaffolded workspaces resolve
`@types/node`, `esbuild`, `srvx`, and `zod` once workspace-wide. `typescript`
is no longer a peer dependency of core — core never imported it, and the peer
edge forked a separate ~175 MB copy of core per TypeScript version in use.
