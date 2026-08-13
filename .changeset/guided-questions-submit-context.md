---
"@agent-native/core": patch
---

Add an optional `submitContext` to the guided-questions payload, appended to the
context of whichever message the card sends. A question card's answer opens a
continuation turn that inherits nothing from the turn that posed it, so context
the follow-up work depends on had no way to survive the hop.
