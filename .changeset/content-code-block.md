---
"@agent-native/core": patch
---

Fix the shared `code` and `code-tabs` block specs so inserting one from a slash menu seeds real content instead of an empty `__raw` string — previously the freshly inserted block got permanently stuck on "Loading code block…" (or a terminal load error) because neither spec had an `empty()` factory.
