---
"@agent-native/core": patch
---

Pin `@tiptap/*` dependencies to an exact, fully-published version (3.27.1) instead of caret ranges. Tiptap extension packages exact-pin their `@tiptap/core` and `@tiptap/pm` peer dependencies, so a caret range let npm climb to the newest tiptap release and fail with `ETARGET No matching version found for @tiptap/extension-table@<x>` during the brief window when a new tiptap version is only partially published. Pinning keeps installs of `@agent-native/core` (and `@agent-native/skills`, which depends on it) reproducible and unaffected by upstream staggered publishes.
