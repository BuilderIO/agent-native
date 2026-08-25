---
"@agent-native/core": patch
---

Skip `git init` when `create` scaffolds into a directory that is already inside a git repository, instead of only when the target directory itself is one. Discovery follows git's own rules, including stopping at filesystem boundaries unless `GIT_DISCOVERY_ACROSS_FILESYSTEM` is set.
