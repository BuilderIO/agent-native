---
"@agent-native/core": patch
---

Shrink the published package by roughly 47 MB of allocated disk per install.
Source maps, the `corpus/core` and `corpus/toolkit` trees, and the `src/` tree
were three separate copies of source that already ships as `dist/`, `docs/`, and
`@agent-native/toolkit`'s own `src/`. The tarball now ships only the eject
entries and scaffolding templates out of `src/`, and `corpus/` carries the
first-party template source that `source-search` actually reads. Docs and
`source-search` now point at `dist/` for framework internals instead of a corpus
path that no longer exists.
