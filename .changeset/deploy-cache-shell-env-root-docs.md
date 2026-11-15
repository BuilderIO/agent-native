---
"@agent-native/core": patch
---

Workspace deploy build cache ignores login-shell and terminal session variables (such as `MANPATH`, `INFOPATH`, `LESS*`, `TMUX*`, `XDG_RUNTIME_DIR`, and `__CF*`) and Markdown files at the workspace root, so a deploy loop started from different shells, or a docs-only commit, reuses cached app builds.
