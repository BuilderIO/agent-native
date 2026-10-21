---
"@agent-native/core": patch
---

Pressing Ctrl+C during `skills add`'s browser sign-in now skips the sign-in, as its hint says: the command ends with the skill installed and prints how to finish signing in later. Before, the spinner printed "Canceled" while the sign-in kept waiting.
