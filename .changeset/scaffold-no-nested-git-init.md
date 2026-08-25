---
"@agent-native/core": patch
---

Skip `git init` when `create` scaffolds into a directory that is already inside a git repository, instead of only when the target directory itself is one. Discovery is delegated to git, so symlinked paths, filesystem boundaries, and `GIT_CEILING_DIRECTORIES` behave exactly as they do everywhere else.
