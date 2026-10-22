---
"@agent-native/core": patch
---

Pressing Ctrl+C during `skills add`'s browser sign-in now skips that sign-in, as its hint says: the skill stays installed, any other selected skills still install, and the command prints how to finish signing in later. Before, the spinner printed "Canceled" while the sign-in kept waiting.
